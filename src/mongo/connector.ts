import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { MongoClient, ObjectId } from 'mongodb';
import type { ClientSession, Collection, Document, Filter } from 'mongodb';
import type { DbTimeoutsOptions } from '../config/index.js';
import { DbConfigError, normalizeDbError } from '../errors/index.js';
import { closeWithTimeout } from '../lifecycle/index.js';
import { shapeRepository, type ResponseShapeOptions } from '../response/index.js';
import type {
  DbEntity,
  DbHealth,
  DbId,
  FindOptions,
  IHealthCheckConnector,
  IDbConnector,
  IRepository,
  ITransactionalConnector,
  RepositoryOptions,
  TransactionOptions,
  TransactionWork,
  UpsertOptions,
} from '../interfaces/index.js';

export interface MongoConnectorOptions {
  url?: string;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  timeouts?: DbTimeoutsOptions;
  responseShape?: ResponseShapeOptions;
}

function buildUrl(options: MongoConnectorOptions): string {
  if (options.url) {
    return options.url;
  }
  const credentials =
    options.username || options.password
      ? `${encodeURIComponent(options.username ?? '')}:${encodeURIComponent(options.password ?? '')}@`
      : '';
  return `mongodb://${credentials}${options.host ?? 'localhost'}:${options.port ?? 27017}`;
}

function conflictTarget(options: UpsertOptions<unknown>): string {
  if (!options?.conflictTarget) {
    throw new DbConfigError('upsert requires a conflictTarget');
  }
  const target = options.conflictTarget;
  const value = Array.isArray(target) ? target[0] : target;
  if (!value) {
    throw new DbConfigError('upsert conflictTarget must not be empty');
  }
  return String(value);
}

function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DbConfigError('Health check timed out', { code: 'HEALTH_TIMEOUT' })), ms);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

@Injectable()
export class MongoConnector
  implements ITransactionalConnector, IHealthCheckConnector, OnModuleInit, OnApplicationShutdown
{
  private readonly client: MongoClient;
  private readonly database: string;
  private readonly ownsClient: boolean;
  private readonly session?: ClientSession;
  private readonly shutdownMs: number;
  private readonly responseShape?: ResponseShapeOptions;

  constructor(
    options: MongoConnectorOptions | MongoClient,
    database?: string,
    ownsClient = false,
    session?: ClientSession,
    responseShape?: ResponseShapeOptions,
  ) {
    const candidate = options as MongoClient;
    if (candidate && typeof candidate.db === 'function') {
      this.client = candidate;
      this.database = database ?? 'test';
      this.ownsClient = ownsClient;
      this.session = session;
      this.shutdownMs = 5000;
      this.responseShape = responseShape;
      return;
    }
    const config = options as MongoConnectorOptions;
    this.client = new MongoClient(buildUrl(config));
    this.database = config.database;
    this.ownsClient = true;
    this.shutdownMs = config.timeouts?.shutdownMs ?? 5000;
    this.responseShape = config.responseShape;
  }

  static fromClient(
    client: MongoClient,
    database: string,
    session?: ClientSession,
    responseShape?: ResponseShapeOptions,
  ): MongoConnector {
    return new MongoConnector(client, database, false, session, responseShape);
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.ownsClient) {
      await closeWithTimeout(
        () => this.client.close(),
        this.shutdownMs,
        () => this.client.close(true),
      );
    }
  }

  private collection<T>(entity: DbEntity<T>): Collection<Document> {
    const name = typeof entity === 'string' ? entity : entity.name;
    const collectionName = name.charAt(0).toLowerCase() + name.slice(1);
    return this.client.db(this.database).collection<Document>(collectionName);
  }

  private sessionOptions(): { session?: ClientSession } {
    return this.session ? { session: this.session } : {};
  }

  private toId(id: DbId, options?: RepositoryOptions): unknown {
    const idType = options?.idType ?? 'objectId';
    if (idType === 'objectId') {
      const candidate = typeof id === 'number' ? String(id) : id;
      if (ObjectId.isValid(candidate)) {
        return new ObjectId(candidate);
      }
      throw new DbConfigError('A Mongo ObjectId must be a 24-character hex string', { details: { field: 'id' } });
    }
    if (idType === 'number') {
      return typeof id === 'number' ? id : Number(id);
    }
    return id;
  }

  private idWhere(id: DbId, options?: RepositoryOptions): Filter<Document> {
    return { [options?.idField ?? '_id']: this.toId(id, options) } as Filter<Document>;
  }

  getRepository<T>(entity: DbEntity<T>, options?: RepositoryOptions): IRepository<T> {
    const collection = this.collection<T>(entity);
    const sessionOptions = this.sessionOptions();

    const findOne = async (id: DbId, idOptions?: RepositoryOptions): Promise<T | null> =>
      (await collection.findOne(this.idWhere(id, idOptions ?? options), sessionOptions)) as T | null;

    const repository: IRepository<T> = {
      findMany: (findOptions?: FindOptions<T>): Promise<T[]> =>
        collection
          .find((findOptions?.where ?? {}) as Filter<Document>, {
            ...sessionOptions,
            limit: findOptions?.limit,
            skip: findOptions?.offset,
          })
          .toArray() as Promise<T[]>,
      findOne,
      count: (where?: Partial<T>): Promise<number> =>
        collection.countDocuments((where ?? {}) as Filter<Document>, sessionOptions),
      create: async (data: Partial<T>): Promise<T> => {
        const result = await collection.insertOne(data as Document, sessionOptions);
        return { ...data, _id: result.insertedId } as T;
      },
      update: async (id: DbId, data: Partial<T>, idOptions?: RepositoryOptions): Promise<T | null> => {
        const result = await collection.updateOne(
          this.idWhere(id, idOptions ?? options),
          { $set: data as Document },
          sessionOptions,
        );
        return result.modifiedCount > 0 ? findOne(id, idOptions) : null;
      },
      delete: async (id: DbId, idOptions?: RepositoryOptions): Promise<boolean> => {
        const result = await collection.deleteOne(this.idWhere(id, idOptions ?? options), sessionOptions);
        return result.deletedCount > 0;
      },
      upsert: async (data: Partial<T>, upsertOptions: UpsertOptions<T>): Promise<T> => {
        const target = conflictTarget(upsertOptions as UpsertOptions<unknown>);
        const value = (data as Record<string, unknown>)[target];
        if (value === undefined) {
          throw new DbConfigError('upsert conflictTarget must exist in the data', { details: { target } });
        }
        const result = await collection.updateOne(
          { [target]: value } as Filter<Document>,
          { $set: data as Document },
          { ...sessionOptions, upsert: true },
        );
        const existing = await collection.findOne(
          result.upsertedId ? { _id: result.upsertedId } : ({ [target]: value } as Filter<Document>),
          sessionOptions,
        );
        if (!existing) {
          throw new DbConfigError('Mongo upsert did not return the written document');
        }
        return existing as T;
      },
    };
    return this.responseShape ? shapeRepository(repository, this.responseShape) : repository;
  }

  transaction<T>(work: TransactionWork<T>, _options?: TransactionOptions): Promise<T> {
    if (this.session) {
      throw new DbConfigError('Nested Mongo transactions are not supported');
    }
    return this.client.withSession((session) =>
      session.withTransaction(() =>
        work(MongoConnector.fromClient(this.client, this.database, session, this.responseShape)),
      ),
    );
  }

  async ping(timeoutMs = 2000): Promise<void> {
    await withTimeout(Promise.resolve(this.client.db(this.database).command({ ping: 1 })), timeoutMs);
  }

  async getHealth(): Promise<DbHealth> {
    const started = Date.now();
    try {
      await this.ping();
      return { status: 'up', driver: 'mongodb', latencyMs: Date.now() - started };
    } catch (error) {
      return { status: 'down', driver: 'mongodb', error: normalizeDbError(error, 'health').message };
    }
  }
}

export type MongoDbConnector = IDbConnector;

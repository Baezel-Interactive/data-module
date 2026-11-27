import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { DbTimeoutsOptions } from '../config/index.js';
import { DbConfigError, normalizeDbError } from '../errors/index.js';
import { closeWithTimeout } from '../lifecycle/index.js';
import { shapeRepository, type ResponseShapeOptions } from '../response/index.js';
import type {
  DbEntity,
  DbHealth,
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
import { withTransactionRetry } from '../transactions/index.js';

export interface PrismaLikeClient {
  $connect(): Promise<unknown>;
  $disconnect(): Promise<unknown>;
  $transaction?<T>(work: (client: PrismaLikeClient) => Promise<T>): Promise<T>;
  $queryRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  [key: string]: any;
}

export interface PrismaConnectorOptions {
  client: PrismaLikeClient;
  timeouts?: DbTimeoutsOptions;
  responseShape?: ResponseShapeOptions;
}

function toId(id: string | number, options?: RepositoryOptions): unknown {
  return options?.idType === 'number' ? (typeof id === 'number' ? id : Number(id)) : id;
}

function idWhere(id: string | number, options?: RepositoryOptions): Record<string, unknown> {
  return { [options?.idField ?? 'id']: toId(id, options) };
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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2025'
  );
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
export class PrismaConnector
  implements ITransactionalConnector, IHealthCheckConnector, OnModuleInit, OnApplicationShutdown
{
  constructor(private readonly options: PrismaConnectorOptions) {}

  async onModuleInit(): Promise<void> {
    await this.options.client.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await closeWithTimeout(
      () => this.options.client.$disconnect(),
      this.options.timeouts?.shutdownMs ?? 5000,
      async () => {
        await this.options.client.$disconnect();
      },
    );
  }

  private delegate<T>(entity: DbEntity<T>): any {
    const name = typeof entity === 'string' ? entity : entity.name;
    const modelName = name.charAt(0).toLowerCase() + name.slice(1);
    const delegate = this.options.client[modelName];
    if (!delegate) {
      throw new DbConfigError(`Prisma model "${modelName}" was not found on the supplied client`);
    }
    return delegate;
  }

  getRepository<T>(entity: DbEntity<T>, options?: RepositoryOptions): IRepository<T> {
    const delegate = this.delegate<T>(entity);
    const repository: IRepository<T> = {
      findMany: (findOptions?: FindOptions<T>): Promise<T[]> =>
        delegate.findMany({ where: findOptions?.where, take: findOptions?.limit, skip: findOptions?.offset }),
      findOne: (id: string | number): Promise<T | null> => delegate.findUnique({ where: idWhere(id, options) }),
      count: (where?: Partial<T>): Promise<number> => delegate.count({ where }),
      create: (data: Partial<T>): Promise<T> => delegate.create({ data }),
      update: async (id: string | number, data: Partial<T>): Promise<T | null> => {
        try {
          return await delegate.update({ where: idWhere(id, options), data });
        } catch (error) {
          if (isNotFound(error)) {
            return null;
          }
          throw normalizeDbError(error, 'repository');
        }
      },
      delete: async (id: string | number): Promise<boolean> => {
        try {
          await delegate.delete({ where: idWhere(id, options) });
          return true;
        } catch (error) {
          if (isNotFound(error)) {
            return false;
          }
          throw normalizeDbError(error, 'repository');
        }
      },
      upsert: async (data: Partial<T>, upsertOptions: UpsertOptions<T>): Promise<T> => {
        const target = conflictTarget(upsertOptions as UpsertOptions<unknown>);
        const value = (data as Record<string, unknown>)[target];
        if (value === undefined) {
          throw new DbConfigError('upsert conflictTarget must exist in the data', { details: { target } });
        }
        return delegate.upsert({ where: { [target]: value }, create: data, update: data });
      },
    };
    return this.options.responseShape ? shapeRepository(repository, this.options.responseShape) : repository;
  }

  transaction<T>(work: TransactionWork<T>, options?: TransactionOptions): Promise<T> {
    const transaction = this.options.client.$transaction;
    if (!transaction) {
      throw new DbConfigError('The supplied Prisma client does not support $transaction');
    }

    return withTransactionRetry(
      () =>
        transaction.call(this.options.client, (client) =>
          work(
            new PrismaConnector({ client: client as PrismaLikeClient, responseShape: this.options.responseShape }),
          ),
        ) as Promise<T>,
      options,
    );
  }

  async ping(timeoutMs = 2000): Promise<void> {
    const client = this.options.client;
    const operation = client.$queryRaw
      ? client.$queryRaw(['SELECT 1'] as unknown as TemplateStringsArray)
      : client.$connect();
    await withTimeout(Promise.resolve(operation), timeoutMs);
  }

  async getHealth(): Promise<DbHealth> {
    const started = Date.now();
    try {
      await this.ping();
      return { status: 'up', driver: 'prisma', latencyMs: Date.now() - started };
    } catch (error) {
      return { status: 'down', driver: 'prisma', error: normalizeDbError(error, 'health').message };
    }
  }
}

export type PrismaRepository<T> = IRepository<T>;
export type PrismaDbConnector = IDbConnector;

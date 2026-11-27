import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DataSourceOptions, EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import type { DbTimeoutsOptions } from '../config/index.js';
import { DbConfigError, DbDestructiveOperationError } from '../errors/index.js';
import { closeWithTimeout } from '../lifecycle/index.js';
import { shapeRepository, type ResponseShapeOptions } from '../response/index.js';
import type {
  DbEntity,
  DbHealth,
  FindOptions,
  IHealthCheckConnector,
  IRepository,
  ITransactionalConnector,
  RepositoryOptions,
  TransactionOptions,
  TransactionWork,
  UpsertOptions,
} from '../interfaces/index.js';
import { withTransactionRetry } from '../transactions/index.js';

function toId(id: string | number, options?: RepositoryOptions): unknown {
  return options?.idType === 'number' ? (typeof id === 'number' ? id : Number(id)) : id;
}

function conflictPaths(options: UpsertOptions<unknown>): string[] {
  if (!options?.conflictTarget) {
    throw new DbConfigError('upsert requires a conflictTarget');
  }
  const target = options.conflictTarget;
  return (Array.isArray(target) ? target : [target]).map(String);
}

function idWhere(id: string | number, options?: RepositoryOptions): Record<string, unknown> {
  return { [options?.idField ?? 'id']: toId(id, options) };
}

function entityTableName(entity: DbEntity<unknown>): string {
  const name = typeof entity === 'string' ? entity : entity.name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function createRepository<T>(repository: Repository<ObjectLiteral>, options?: RepositoryOptions): IRepository<T> {
  const findOne = (id: string | number): Promise<T | null> =>
    repository.findOneBy(idWhere(id, options) as never) as Promise<T | null>;

  return {
    findMany: (findOptions?: FindOptions<T>): Promise<T[]> =>
      repository.find({
        where: findOptions?.where as never,
        take: findOptions?.limit,
        skip: findOptions?.offset,
      }) as Promise<T[]>,
    findOne,
    count: (where?: Partial<T>): Promise<number> => repository.count({ where: where as never }),
    create: (data: Partial<T>): Promise<T> => repository.save(repository.create(data as never)) as Promise<T>,
    update: async (id: string | number, data: Partial<T>): Promise<T | null> => {
      const result = await repository.update(idWhere(id, options) as never, data as never);
      return result.affected ? findOne(id) : null;
    },
    delete: async (id: string | number): Promise<boolean> => {
      const result = await repository.delete(idWhere(id, options) as never);
      return (result.affected ?? 0) > 0;
    },
    upsert: async (data: Partial<T>, upsertOptions: UpsertOptions<T>): Promise<T> => {
      const paths = conflictPaths(upsertOptions as UpsertOptions<unknown>);
      const values = paths.map((path) => (data as Record<string, unknown>)[path]);
      if (values.some((value) => value === undefined)) {
        throw new DbConfigError('upsert conflictTarget must exist in the data', { details: { paths } });
      }
      await repository.upsert(data as never, { conflictPaths: paths });
      const where = Object.fromEntries(paths.map((path, index) => [path, values[index]]));
      return repository.findOneBy(where as never) as Promise<T>;
    },
  };
}

function connectorFromManager(
  manager: EntityManager,
  responseShape?: ResponseShapeOptions,
): ITransactionalConnector {
  return {
    getRepository: <T>(entity: DbEntity<T>, options?: RepositoryOptions): IRepository<T> => {
      const repository = createRepository<T>(
        manager.getRepository(entity as EntityTarget<ObjectLiteral>) as Repository<ObjectLiteral>,
        options,
      );
      repository.transaction = <R>(work: (repository: IRepository<T>) => Promise<R>) => work(repository);
      return responseShape
        ? shapeRepository(repository, responseShape, options?.uuidTable ?? entityTableName(entity))
        : repository;
    },
  };
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
export class TypeOrmConnector
  implements ITransactionalConnector, IHealthCheckConnector, OnModuleInit, OnApplicationShutdown
{
  private readonly dataSource: DataSource;
  private readonly exposeDataSource: boolean;
  private readonly shutdownMs: number;
  private readonly responseShape?: ResponseShapeOptions;

  constructor(
    options: DataSourceOptions | DataSource,
    safety: {
      exposeDataSource?: boolean;
      timeouts?: DbTimeoutsOptions;
      responseShape?: ResponseShapeOptions;
    } = {},
  ) {
    this.dataSource = options instanceof DataSource ? options : new DataSource(options);
    this.exposeDataSource = safety.exposeDataSource ?? false;
    this.shutdownMs = safety.timeouts?.shutdownMs ?? 5000;
    this.responseShape = safety.responseShape;
  }

  async onModuleInit(): Promise<void> {
    if (!this.dataSource.isInitialized) {
      await this.dataSource.initialize();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await closeWithTimeout(
        () => this.dataSource.destroy(),
        this.shutdownMs,
        () => this.dataSource.destroy(),
      );
    }
  }

  getRepository<T>(entity: DbEntity<T>, options?: RepositoryOptions): IRepository<T> {
    const repository = createRepository<T>(
      this.dataSource.getRepository(entity as EntityTarget<ObjectLiteral>) as Repository<ObjectLiteral>,
      options,
    );
    repository.transaction = <R>(work: (repository: IRepository<T>) => Promise<R>) =>
      this.dataSource.transaction(async (manager) =>
        work(
          createRepository<T>(
            manager.getRepository(entity as EntityTarget<ObjectLiteral>) as Repository<ObjectLiteral>,
            options,
          ),
        ),
      );
    return this.responseShape
      ? shapeRepository(repository, this.responseShape, options?.uuidTable ?? entityTableName(entity))
      : repository;
  }

  getDataSource(): DataSource {
    if (!this.exposeDataSource) {
      throw new DbDestructiveOperationError(
        'Raw DataSource access is disabled; set safety.exposeDataSource to enable it',
      );
    }
    return this.dataSource;
  }

  transaction<T>(work: TransactionWork<T>, options?: TransactionOptions): Promise<T> {
    return withTransactionRetry(
      () => this.dataSource.transaction((manager) => work(connectorFromManager(manager, this.responseShape))),
      options,
    );
  }

  async ping(timeoutMs = 2000): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    try {
      await withTimeout(Promise.resolve(runner.query('SELECT 1')), timeoutMs);
    } finally {
      await runner.release();
    }
  }

  async getHealth(): Promise<DbHealth> {
    const started = Date.now();
    try {
      await this.ping();
      return { status: 'up', driver: 'typeorm', latencyMs: Date.now() - started };
    } catch (error) {
      const normalized =
        error instanceof DbConfigError
          ? error
          : new DbConfigError('Health check failed', { details: { cause: String(error) } });
      return { status: 'down', driver: 'typeorm', error: normalized.message };
    }
  }
}

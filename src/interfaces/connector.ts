export type DbEntity<T> = string | (new () => T);
export type DbId = string | number;
export type DbIdType = 'objectId' | 'string' | 'number' | 'uuid';

export interface RepositoryOptions {
  idType?: DbIdType;
}

export interface FindOptions<T> {
  where?: Partial<T>;
  limit?: number;
  offset?: number;
}

export interface UpsertOptions<T> {
  conflictTarget: keyof T | Array<keyof T> | string;
}

export interface IRepository<T> {
  findMany(options?: FindOptions<T>): Promise<T[]>;
  findOne(id: DbId, options?: RepositoryOptions): Promise<T | null>;
  count(where?: Partial<T>): Promise<number>;
  create(data: Partial<T>): Promise<T>;
  update(id: DbId, data: Partial<T>, options?: RepositoryOptions): Promise<T | null>;
  delete(id: DbId, options?: RepositoryOptions): Promise<boolean>;
  upsert(data: Partial<T>, options: UpsertOptions<T>): Promise<T>;
}

export interface ISqlRepository<T> extends IRepository<T> {
  raw?(): unknown;
}

export interface IMongoRepository<T> extends IRepository<T> {
  raw?(): unknown;
}

export interface IDbConnector {
  getRepository<T>(entity: DbEntity<T>, options?: RepositoryOptions): IRepository<T>;
}

export interface DbHealth {
  status: 'up' | 'down';
  driver?: string;
  latencyMs?: number;
  error?: string;
}

export interface TransactionOptions {
  retries?: number;
  timeoutMs?: number;
}

export type TransactionWork<T> = (connector: ITransactionalConnector) => Promise<T>;

export interface ITransactionalConnector extends IDbConnector {
  transaction?<T>(work: TransactionWork<T>, options?: TransactionOptions): Promise<T>;
}

export interface IHealthCheckConnector extends IDbConnector {
  ping?(timeoutMs?: number): Promise<void>;
  getHealth?(): Promise<DbHealth>;
}

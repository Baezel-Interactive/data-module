export type DbEntity<T> = string | (new () => T);

export interface IRepository<T> {
  findMany(): Promise<T[]>;
  findOne(id: number): Promise<T | null>;
}

export interface IDbConnector {
  getRepository<T>(entity: DbEntity<T>): IRepository<T>;
}

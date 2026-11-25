import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTOR } from '../constants';
import type { DbEntity, IDbConnector, IRepository } from '../interfaces';

@Injectable()
export class DbService implements IDbConnector {
  constructor(@Inject(DB_CONNECTOR) private readonly connector: IDbConnector) {}

  getRepository<T>(entity: DbEntity<T>): IRepository<T> {
    return this.connector.getRepository(entity);
  }

  getConnector(): IDbConnector {
    return this.connector;
  }
}

import { ModuleMetadata, Type } from '@nestjs/common';
import type { IDbConnector } from './connector';

export interface DbModuleOptions {
  connector: IDbConnector;
}

export interface DbConnectorFactory {
  createConnector(): Promise<IDbConnector> | IDbConnector;
}

export interface DbModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (...args: any[]) => Promise<IDbConnector> | IDbConnector;
  useClass?: Type<DbConnectorFactory>;
  useExisting?: Type<DbConnectorFactory>;
  inject?: any[];
}

import { ModuleMetadata, Type } from '@nestjs/common';
import type { DbOptionsInput } from '../config/schema.js';
import type { Hooks } from '../hooks/index.js';
import type { IDbConnector } from './connector.js';

export interface DbModuleOptions {
  dbOptions: DbOptionsInput;
  connector?: IDbConnector;
  hooks?: Hooks;
}

export type DbRegistrationResult = DbModuleOptions;

export interface DbConnectorFactory {
  createConnector(): Promise<DbRegistrationResult> | DbRegistrationResult;
}

export interface DbModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (...args: any[]) => Promise<DbRegistrationResult> | DbRegistrationResult;
  useClass?: Type<DbConnectorFactory>;
  useExisting?: Type<DbConnectorFactory>;
  inject?: any[];
}

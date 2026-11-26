import { ModuleMetadata, Type } from '@nestjs/common';
import type { Hooks } from '../hooks/index.js';
import type { DbRegistrationInput } from '../config/registration.js';
import type { IDbConnector } from './connector.js';

export interface DbModuleOptions {
  connector: IDbConnector;
  hooks?: Hooks;
}

export type DbRegistrationResult = IDbConnector | DbRegistrationInput;

export interface DbConnectorFactory {
  createConnector(): Promise<DbRegistrationResult> | DbRegistrationResult;
}

export interface DbModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (...args: any[]) => Promise<DbRegistrationResult> | DbRegistrationResult;
  useClass?: Type<DbConnectorFactory>;
  useExisting?: Type<DbConnectorFactory>;
  inject?: any[];
}

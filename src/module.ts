import { DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { normalizeRegistrationValue, resolveConnector } from './config/index.js';
import { DB_CONNECTOR, DB_MODULE_OPTIONS } from './constants.js';
import type { DbConnectorFactory, DbModuleAsyncOptions, DbModuleOptions } from './interfaces/index.js';
import { DbService } from './services/index.js';

@Global()
@Module({})
export class DbModule {
  static register(options: DbModuleOptions): DynamicModule {
    const registration = normalizeRegistrationValue(options);
    return {
      module: DbModule,
      providers: [
        { provide: DB_MODULE_OPTIONS, useValue: registration },
        { provide: DB_CONNECTOR, useFactory: () => resolveConnector(registration) },
        DbService,
      ],
      exports: [DB_CONNECTOR, DbService],
    };
  }

  static registerAsync(options: DbModuleAsyncOptions): DynamicModule {
    return {
      module: DbModule,
      imports: options.imports ?? [],
      providers: [
        DbModule.createOptionsProvider(options),
        {
          provide: DB_CONNECTOR,
          useFactory: async (value: unknown) => resolveConnector(normalizeRegistrationValue(value)),
          inject: [DB_MODULE_OPTIONS],
        },
        DbService,
      ],
      exports: [DB_CONNECTOR, DbService],
    };
  }

  private static createOptionsProvider(options: DbModuleAsyncOptions): Provider {
    if (options.useFactory) {
      return {
        provide: DB_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      };
    }

    if (options.useClass) {
      return { provide: DB_MODULE_OPTIONS, useClass: options.useClass as Type<DbConnectorFactory> };
    }

    if (options.useExisting) {
      return { provide: DB_MODULE_OPTIONS, useExisting: options.useExisting };
    }

    throw new Error('DbModule.registerAsync requires one of useFactory, useClass or useExisting');
  }
}

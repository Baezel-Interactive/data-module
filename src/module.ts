import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { DB_CONNECTOR, DB_MODULE_OPTIONS } from './constants';
import type { DbModuleAsyncOptions, DbModuleOptions, IDbConnector } from './interfaces';
import { DbService } from './services';

@Global()
@Module({})
export class DbModule {
  static register(options: DbModuleOptions): DynamicModule {
    return {
      module: DbModule,
      providers: [
        {
          provide: DB_CONNECTOR,
          useValue: options.connector,
        },
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
          useFactory: (connector: IDbConnector) => connector,
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
      return { provide: DB_MODULE_OPTIONS, useClass: options.useClass };
    }

    if (options.useExisting) {
      return { provide: DB_MODULE_OPTIONS, useExisting: options.useExisting };
    }

    throw new Error('DbModule.registerAsync requires one of useFactory, useClass or useExisting');
  }
}

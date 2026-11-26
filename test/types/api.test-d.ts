import { describe, expectTypeOf, it } from 'vitest';
import { DbModule } from '../../src/index.js';
import type { DbModuleOptions, DriverRegistrationInput, IDbConnector, IRepository } from '../../src/index.js';

const connector: IDbConnector = {
  getRepository: <T>(): IRepository<T> => ({
    findMany: async () => [] as T[],
    findOne: async () => null,
    count: async () => 0,
    create: async (data) => data as T,
    update: async () => null,
    delete: async () => false,
    upsert: async (data) => data as T,
  }),
};

const options: DbModuleOptions = { connector };

const driverInput: DriverRegistrationInput = {
  kind: 'driver',
  driver: 'postgres',
  config: { host: 'localhost' },
  connectorFactory: () => connector,
};

describe('public API types', () => {
  it('accepts connector and driver registration forms', () => {
    expectTypeOf(options).toMatchTypeOf<DbModuleOptions>();
    expectTypeOf(driverInput).toMatchTypeOf<DriverRegistrationInput>();
    expectTypeOf(DbModule.register).parameter(0).toEqualTypeOf<DbModuleOptions | DriverRegistrationInput>();
    expectTypeOf(DbModule.registerAsync).parameter(0).toHaveProperty('useFactory');
    expectTypeOf(DbModule.registerAsync).parameter(0).toHaveProperty('useClass');
  });
});

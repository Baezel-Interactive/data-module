import { describe, expectTypeOf, it } from 'vitest';
import { DbModule } from '../../src/index.js';
import type { DbModuleOptions, IDbConnector, IRepository } from '../../src/index.js';

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

const options: DbModuleOptions = {
  dbOptions: { driver: 'postgres', config: { host: 'localhost', database: 'app' } },
  connector,
};

describe('public API types', () => {
  it('requires dbOptions and allows a connector override', () => {
    expectTypeOf(options).toMatchTypeOf<DbModuleOptions>();
    expectTypeOf(DbModule.register).parameter(0).toEqualTypeOf<DbModuleOptions>();
    expectTypeOf(DbModule.registerAsync).parameter(0).toHaveProperty('useFactory');
    expectTypeOf(DbModule.registerAsync).parameter(0).toHaveProperty('useClass');

    // @ts-expect-error bare connector registration is removed
    DbModule.register({ connector });
    const legacy = {
      kind: 'driver',
      driver: 'postgres',
      config: {},
      connectorFactory: () => connector,
    };
    // @ts-expect-error legacy driver registration is removed
    DbModule.register(legacy);
  });
});

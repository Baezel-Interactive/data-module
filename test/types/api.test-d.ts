import { describe, expectTypeOf, it } from 'vitest';
import { createConnectorFromDbOptions, DbModule } from '../../src/index.js';
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
  });

  it('reflects the intentional async factory signature', () => {
    expectTypeOf(createConnectorFromDbOptions).returns.toEqualTypeOf<Promise<IDbConnector>>();
  });

  it('rejects removed shapes', () => {
    // @ts-expect-error bare connector registration is removed
    DbModule.register({ connector });
    // @ts-expect-error legacy kind registration is removed
    DbModule.register({ kind: 'driver', driver: 'postgres', config: {}, connectorFactory: () => connector });
    // @ts-expect-error connectorFactory is removed
    DbModule.register({ connectorFactory: () => connector });
    // @ts-expect-error driver/config without dbOptions is removed
    DbModule.register({ driver: 'postgres', config: {} });
    // @ts-expect-error bare connector without dbOptions is removed
    DbModule.register({ connector });
  });
});

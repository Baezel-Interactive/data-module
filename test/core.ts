import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DB_CONNECTOR, DbModule, DbService } from '../src/index.js';
import type { IDbConnector, IRepository } from '../src/index.js';

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

const dbOptions = {
  driver: 'postgres' as const,
  config: { host: 'localhost', database: 'app' },
  provisioning: { createIfMissing: false },
};

describe('DbModule', () => {
  it('register provides the supplied connector through DbService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule.register({ dbOptions, connector })],
    }).compile();

    expect(moduleRef.get(DbService).getConnector()).toBe(connector);
  });

  it('registerAsync resolves options from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DbModule.registerAsync({
          useFactory: () => ({ dbOptions, connector }),
        }),
      ],
    }).compile();

    expect(moduleRef.get(DB_CONNECTOR)).toBe(connector);
  });

  it('rejects registration without dbOptions', () => {
    expect(() => DbModule.register({ connector } as never)).toThrow(/dbOptions/);
  });
});

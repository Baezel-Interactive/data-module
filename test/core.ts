import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { DB_CONNECTOR, DbModule, DbService } from '../src';
import type { IDbConnector, IRepository } from '../src';

describe('DbModule', () => {
  const connector: IDbConnector = {
    getRepository: <T>(): IRepository<T> => ({
      findMany: async () => [] as T[],
      findOne: async () => null,
    }),
  };

  it('register provides the supplied connector through DbService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule.register({ connector })],
    }).compile();

    expect(moduleRef.get(DbService).getConnector()).toBe(connector);
  });

  it('registerAsync resolves a connector from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule.registerAsync({ useFactory: () => connector })],
    }).compile();

    expect(moduleRef.get(DB_CONNECTOR)).toBe(connector);
  });
});

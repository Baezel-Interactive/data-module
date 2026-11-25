import 'reflect-metadata';

jest.mock('typeorm', () => {
  const find = jest.fn().mockResolvedValue([{ id: 1 }]);
  const findOneBy = jest.fn().mockResolvedValue({ id: 1 });
  const initialize = jest.fn();
  const destroy = jest.fn();

  class DataSource {
    isInitialized = false;

    async initialize(): Promise<void> {
      initialize();
      this.isInitialized = true;
    }

    async destroy(): Promise<void> {
      destroy();
      this.isInitialized = false;
    }

    getRepository() {
      return { find, findOneBy };
    }
  }

  return { DataSource, __mocks: { find, findOneBy, initialize, destroy } };
});

import * as typeorm from 'typeorm';
import { TypeOrmConnector } from '../src/typeorm';

describe('TypeOrmConnector', () => {
  it('initializes and delegates to the TypeORM repository', async () => {
    const mocks = (typeorm as any).__mocks;
    const connector = new TypeOrmConnector({ type: 'postgres' } as any);
    await connector.onModuleInit();

    const repository = connector.getRepository('User');
    expect(await repository.findMany()).toEqual([{ id: 1 }]);
    expect(await repository.findOne(1)).toEqual({ id: 1 });
    expect(mocks.findOneBy).toHaveBeenCalledWith({ id: 1 });

    await connector.onModuleDestroy();
    expect(mocks.initialize).toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalled();
  });
});

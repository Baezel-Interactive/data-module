import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DbConfigError, DbDestructiveOperationError } from '../src/index.js';
import { TypeOrmConnector } from '../src/typeorm/index.js';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  findOneBy: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  upsert: vi.fn(),
  initialize: vi.fn(),
  destroy: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('typeorm', () => {
  class DataSource {
    isInitialized = false;

    async initialize(): Promise<void> {
      mocks.initialize();
      this.isInitialized = true;
    }

    async destroy(): Promise<void> {
      mocks.destroy();
      this.isInitialized = false;
    }

    createQueryRunner() {
      return { query: mocks.query, release: mocks.release };
    }

    getRepository() {
      return {
        find: mocks.find,
        findOneBy: mocks.findOneBy,
        count: mocks.count,
        create: mocks.create,
        save: mocks.save,
        update: mocks.update,
        delete: mocks.delete,
        upsert: mocks.upsert,
      };
    }

    async transaction(work: (manager: unknown) => Promise<unknown>): Promise<unknown> {
      return mocks.transaction(work);
    }
  }

  return { DataSource };
});

describe('TypeOrmConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue([{ id: 1 }]);
    mocks.findOneBy.mockResolvedValue({ id: 1 });
    mocks.count.mockResolvedValue(1);
    mocks.create.mockImplementation((data: unknown) => data);
    mocks.save.mockImplementation((entity: unknown) => Promise.resolve(entity));
    mocks.update.mockResolvedValue({ affected: 1 });
    mocks.delete.mockResolvedValue({ affected: 1 });
    mocks.upsert.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async (work: (manager: unknown) => Promise<unknown>) =>
      work({ getRepository: () => ({ findOneBy: mocks.findOneBy }) }),
    );
  });

  it('initializes and delegates to the TypeORM repository', async () => {
    const connector = new TypeOrmConnector({ type: 'postgres' });
    await connector.onModuleInit();

    const repository = connector.getRepository('User');
    expect(await repository.findMany()).toEqual([{ id: 1 }]);
    expect(await repository.findOne(1)).toEqual({ id: 1 });
    expect(mocks.findOneBy).toHaveBeenCalledWith({ id: 1 });

    await connector.onApplicationShutdown();
    expect(mocks.initialize).toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalled();
  });

  it('performs CRUD and requires an upsert conflict target', async () => {
    const connector = new TypeOrmConnector({ type: 'postgres' });
    const repository = connector.getRepository<{ id: number; email: string }>('User');

    expect(await repository.count()).toBe(1);
    expect(await repository.create({ email: 'a@example.com' })).toEqual({ email: 'a@example.com' });
    expect(await repository.update(1, { email: 'b@example.com' })).toEqual({ id: 1 });
    expect(await repository.delete(1)).toBe(true);
    expect(await repository.upsert({ id: 1, email: 'a@example.com' }, { conflictTarget: 'email' })).toEqual({
      id: 1,
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@example.com' }),
      expect.objectContaining({ conflictPaths: ['email'] }),
    );

    await expect(repository.upsert({ id: 1 }, {} as never)).rejects.toBeInstanceOf(DbConfigError);
  });

  it('runs work inside a transaction using a bound connector', async () => {
    const connector = new TypeOrmConnector({ type: 'postgres' });
    const result = await connector.transaction(async (tx) => {
      expect(tx.getRepository('User').findOne).toBeTypeOf('function');
      return 'done';
    });

    expect(result).toBe('done');
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('hides the raw DataSource unless explicitly exposed', () => {
    const connector = new TypeOrmConnector({ type: 'postgres' });
    expect(() => connector.getDataSource()).toThrow(DbDestructiveOperationError);

    const exposed = new TypeOrmConnector({ type: 'postgres' }, { exposeDataSource: true });
    expect(exposed.getDataSource()).toBeDefined();
  });

  it('reports health using a dedicated query runner', async () => {
    const connector = new TypeOrmConnector({ type: 'postgres' });

    expect(await connector.getHealth()).toMatchObject({ status: 'up', driver: 'typeorm' });
    expect(mocks.query).toHaveBeenCalledWith('SELECT 1');
    expect(mocks.release).toHaveBeenCalled();
  });
});

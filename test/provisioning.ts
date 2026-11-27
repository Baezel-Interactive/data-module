import type { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectorFactoryContext,
  DbConfigError,
  DbModule,
  DbProvisioningError,
  parseDbOptions,
  provisionDatabase,
  type ConnectorFactoryContext,
} from '../src/index.js';

const pgMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  options: [] as Array<Record<string, unknown>>,
}));

vi.mock('pg', () => ({
  Client: class {
    constructor(options: Record<string, unknown>) {
      pgMocks.options.push(options);
    }
    async connect(): Promise<void> {
      await pgMocks.connect();
    }
    async query(sql: string, parameters?: unknown[]): Promise<{ rowCount: number | null }> {
      return pgMocks.query(sql, parameters);
    }
    async end(): Promise<void> {
      await pgMocks.end();
    }
  },
}));

const mysqlMocks = vi.hoisted(() => ({
  createConnection: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock('mysql2/promise', () => ({
  createConnection: async (options: Record<string, unknown>) => {
    mysqlMocks.createConnection(options);
    return {
      query: mysqlMocks.query,
      end: async () => {
        await mysqlMocks.end();
      },
    };
  },
}));

const mongoMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  command: vi.fn(),
  close: vi.fn(),
  url: '',
  options: undefined as Record<string, unknown> | undefined,
}));

vi.mock('mongodb', () => ({
  MongoClient: class {
    constructor(url: string, options: Record<string, unknown>) {
      mongoMocks.url = url;
      mongoMocks.options = options;
    }
    async connect(): Promise<void> {
      await mongoMocks.connect();
    }
    db(): { command: typeof mongoMocks.command } {
      return { command: mongoMocks.command };
    }
    async close(): Promise<void> {
      await mongoMocks.close();
    }
  },
}));

function createContext(
  overrides: Partial<ConnectorFactoryContext> = {},
): ConnectorFactoryContext & { logger: Logger } {
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  } as unknown as Logger;
  const dbOptions = parseDbOptions({
    driver: 'postgres',
    config: { host: 'localhost', database: 'app', username: 'user', password: 'super-secret' },
  });
  return Object.assign(createConnectorFactoryContext(dbOptions, logger), overrides) as ConnectorFactoryContext & {
    logger: Logger;
  };
}

describe('database provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgMocks.options.length = 0;
    pgMocks.query.mockImplementation(async (sql: string) => (sql.startsWith('SELECT') ? { rowCount: 0 } : {}));
    mysqlMocks.query.mockResolvedValue([[], []]);
    mongoMocks.command.mockResolvedValue({ ok: 1 });
  });

  it('creates a missing Postgres database, logs it and emits hooks', async () => {
    const onEvent = vi.fn();
    const context = createContext({ hooks: { onEvent } });

    await provisionDatabase(context);

    expect(pgMocks.query).toHaveBeenCalledWith(expect.stringContaining('CREATE DATABASE "app"'), undefined);
    expect(context.logger.log).toHaveBeenCalledWith('Database "app" did not exist; created it.');
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'provisioning:complete' }));
    expect(JSON.stringify(vi.mocked(context.logger.log).mock.calls)).not.toContain('super-secret');
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain('super-secret');
  });

  it('treats a concurrent CREATE DATABASE as success', async () => {
    pgMocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) {
        return { rowCount: 0 };
      }
      throw Object.assign(new Error('duplicate database'), { code: '42P04' });
    });

    await expect(provisionDatabase(createContext())).resolves.toBeUndefined();
    expect(createContext().logger.log).not.toHaveBeenCalled();
  });

  it('does not provision by default in production', async () => {
    await provisionDatabase(createContext({ environment: 'production' }));
    expect(pgMocks.connect).not.toHaveBeenCalled();
    expect(pgMocks.query).not.toHaveBeenCalled();
  });

  it('creates a missing MySQL schema with utf8mb4', async () => {
    await provisionDatabase(createContext({ driver: 'mysql', config: { host: 'localhost', database: 'app' } }));

    expect(mysqlMocks.query).toHaveBeenCalledWith(expect.stringContaining('CREATE DATABASE IF NOT EXISTS `app`'));
    expect(mysqlMocks.query).toHaveBeenCalledWith(expect.stringContaining('CHARACTER SET utf8mb4'));
  });

  it('only verifies Mongo connectivity and warns that createIfMissing is SQL-only', async () => {
    const context = createContext({
      driver: 'mongodb',
      config: { url: 'mongodb://user:super-secret@localhost:27017/app' },
      provisioning: { createIfMissing: true },
    });

    await provisionDatabase(context);

    expect(mongoMocks.connect).toHaveBeenCalled();
    expect(mongoMocks.command).toHaveBeenCalledWith({ ping: 1 });
    expect(context.logger.warn).toHaveBeenCalledWith(expect.stringContaining('SQL-only'));
    expect(context.logger.log).toHaveBeenCalledWith(expect.stringContaining('created lazily'));
  });

  it('rejects invalid database identifiers', async () => {
    await expect(
      provisionDatabase(createContext({ config: { host: 'localhost', database: 'bad;DROP DATABASE app' } })),
    ).rejects.toBeInstanceOf(DbConfigError);
  });

  it('retries transient connection failures', async () => {
    pgMocks.connect
      .mockRejectedValueOnce(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }))
      .mockResolvedValue(undefined);

    await provisionDatabase(createContext({ provisioning: { retries: 2, timeoutMs: 1000 } }));

    expect(pgMocks.connect).toHaveBeenCalledTimes(2);
  });

  it('handles two concurrent boots without failing either', async () => {
    let createCalls = 0;
    pgMocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) {
        return { rowCount: 0 };
      }
      createCalls += 1;
      if (createCalls > 1) {
        throw Object.assign(new Error('duplicate database'), { code: '42P04' });
      }
      return {};
    });

    await expect(
      Promise.all([provisionDatabase(createContext()), provisionDatabase(createContext())]),
    ).resolves.toEqual([undefined, undefined]);
  });

  it('surfaces redacted DbProvisioningError through Nest bootstrap', async () => {
    const secret = 'super-secret';
    pgMocks.connect.mockRejectedValue(
      Object.assign(new Error(`unknown database password ${secret}`), { code: '3D000' }),
    );

    let thrown: unknown;
    try {
      await Test.createTestingModule({
        imports: [
          DbModule.register({
            dbOptions: {
              driver: 'postgres',
              config: { host: 'localhost', database: 'expenses', password: secret },
              provisioning: { createIfMissing: true, retries: 0 },
            },
          }),
        ],
      }).compile();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DbProvisioningError);
    expect(thrown).toMatchObject({ name: 'DbProvisioningError', code: 'DATABASE_NOT_FOUND' });
    expect(String(thrown)).not.toContain(secret);
    expect(JSON.stringify(thrown)).not.toContain(secret);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertDestructiveOperation,
  assertSafetyAllowed,
  DbConfigError,
  DbDestructiveOperationError,
  guardDestructiveSql,
  isDestructiveSql,
  migrationChecksum,
  withMongoMigrationLock,
  withMysqlMigrationLock,
  withPostgresAdvisoryLock,
  wrapQueryRunner,
  type ConnectorFactoryContext,
  type MongoLockCollection,
} from '../src/index.js';

function createContext(overrides: Partial<ConnectorFactoryContext> = {}): ConnectorFactoryContext & {
  logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
} {
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  };
  return {
    driver: 'postgres',
    config: { host: 'localhost', database: 'app' },
    safety: {
      allowSchemaSync: false,
      allowDropSchema: false,
      allowDropDatabase: false,
      allowDestructiveMigrations: false,
      allowInsecureTls: false,
    },
    provisioning: {},
    entities: { glob: [], discoverDecorators: false },
    environment: 'development',
    hooks: undefined,
    logger: logger as unknown as ConnectorFactoryContext['logger'],
    ...overrides,
  } as ConnectorFactoryContext & { logger: typeof logger };
}

describe('safety policy', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('hard-fails on unsafe flags in production', async () => {
    const context = createContext({
      environment: 'production',
      safety: {
        allowSchemaSync: true,
        allowDropSchema: false,
        allowDropDatabase: false,
        allowDestructiveMigrations: false,
        allowInsecureTls: false,
        exposeDataSource: false,
        allowSeed: false,
      },
    });

    await expect(assertSafetyAllowed(context)).rejects.toBeInstanceOf(DbDestructiveOperationError);
  });

  it('warns when unsafe flags are enabled outside production', async () => {
    const context = createContext({
      safety: {
        allowSchemaSync: false,
        allowDropSchema: true,
        allowDropDatabase: false,
        allowDestructiveMigrations: false,
        allowInsecureTls: false,
        exposeDataSource: false,
        allowSeed: false,
      },
    });

    await expect(assertSafetyAllowed(context)).resolves.toBeUndefined();
    expect(context.logger.warn).toHaveBeenCalledWith(expect.stringContaining('allowDropSchema'));
  });

  it('warns and emits a hook for a dangerous environment override', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const onEvent = vi.fn();
    const context = createContext({ environment: 'development', hooks: { onEvent } });

    await assertSafetyAllowed(context);

    expect(context.logger.warn).toHaveBeenCalledWith(expect.stringContaining('environment override'));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'environment:override' }));
  });

  it('requires an explicit flag when TLS verification is disabled', async () => {
    const config = { host: 'localhost', database: 'app', ssl: { rejectUnauthorized: false } };
    await expect(assertSafetyAllowed(createContext({ environment: 'production', config }))).rejects.toBeInstanceOf(
      DbConfigError,
    );

    const allowed = createContext({
      environment: 'development',
      config,
      safety: {
        allowSchemaSync: false,
        allowDropSchema: false,
        allowDropDatabase: false,
        allowDestructiveMigrations: false,
        allowInsecureTls: true,
        exposeDataSource: false,
        allowSeed: false,
      },
    });
    await expect(assertSafetyAllowed(allowed)).resolves.toBeUndefined();
    expect(allowed.logger.warn).toHaveBeenCalledWith(expect.stringContaining('TLS verification'));
  });

  it('blocks destructive operations unless a flag or explicit override is present', () => {
    const context = createContext();
    expect(() => assertDestructiveOperation(context, 'dropSchema')).toThrow(DbDestructiveOperationError);
    expect(() => assertDestructiveOperation(context, 'dropSchema', { override: true })).not.toThrow();
  });
});

describe('destructive SQL guard', () => {
  it('detects destructive statements but ignores comments and string literals', () => {
    expect(isDestructiveSql('DROP TABLE users')).toBe(true);
    expect(isDestructiveSql('DELETE FROM users')).toBe(true);
    expect(isDestructiveSql('TRUNCATE users')).toBe(true);
    expect(isDestructiveSql('ALTER TABLE users DROP COLUMN name')).toBe(true);
    expect(isDestructiveSql('-- DROP TABLE users\nSELECT 1')).toBe(false);
    expect(isDestructiveSql("SELECT 'DELETE FROM users'")).toBe(false);
  });

  it('guards intercepted queryRunner.query calls', async () => {
    const runner = { query: vi.fn().mockResolvedValue(undefined) };
    const guarded = wrapQueryRunner(runner, createContext(), { override: false });

    await expect(guarded.query('CREATE TABLE ok (id int)')).resolves.toBeUndefined();
    await expect(guarded.query('DROP TABLE ok')).rejects.toBeInstanceOf(DbDestructiveOperationError);
    expect(runner.query).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit per-migration override', () => {
    expect(() => guardDestructiveSql('DROP TABLE ok', createContext(), { override: true })).not.toThrow();
  });
});

describe('migration checksum', () => {
  it('normalizes line endings before hashing', () => {
    expect(migrationChecksum('select 1;\r\nselect 2;')).toBe(migrationChecksum('select 1;\nselect 2;'));
  });
});

describe('migration locks', () => {
  it('acquires and releases a Postgres advisory lock even on failure', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await expect(
      withPostgresAdvisoryLock({ query }, 42, async () => {
        throw new Error('migration failed');
      }),
    ).rejects.toThrow('migration failed');

    expect(query).toHaveBeenNthCalledWith(1, 'SELECT pg_advisory_lock($1)', [42]);
    expect(query).toHaveBeenNthCalledWith(2, 'SELECT pg_advisory_unlock($1)', [42]);
  });

  it('acquires and releases a MySQL named lock', async () => {
    const query = vi.fn(async (sql: string) => (sql.includes('GET_LOCK') ? [[{ acquired: 1 }], []] : [[], []]));

    await expect(withMysqlMigrationLock({ query }, 'migration', async () => 'done')).resolves.toBe('done');
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT GET_LOCK(?, ?) AS acquired', ['migration', 10]);
    expect(query).toHaveBeenNthCalledWith(2, 'SELECT RELEASE_LOCK(?)', ['migration']);
  });

  it('refuses to run when the MySQL lock is held', async () => {
    const query = vi.fn().mockResolvedValue([[{ acquired: 0 }], []]);

    await expect(withMysqlMigrationLock({ query }, 'migration', async () => 'done')).rejects.toBeInstanceOf(
      DbConfigError,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  function lockCollection(existing?: Date): MongoLockCollection {
    let document = existing ? { name: 'migration', expiresAt: existing } : undefined;
    return {
      createIndex: vi.fn().mockResolvedValue('index'),
      insertOne: vi.fn(async (value: { name: string; expiresAt: Date }) => {
        if (document) {
          throw new Error('duplicate key');
        }
        document = value;
      }),
      findOne: vi.fn(async () => document ?? null),
      replaceOne: vi.fn(async (filter: { expiresAt: Date }, replacement: { expiresAt: Date }) => {
        if (document?.expiresAt.getTime() !== filter.expiresAt.getTime()) {
          return { modifiedCount: 0 };
        }
        document = { name: 'migration', expiresAt: replacement.expiresAt };
        return { modifiedCount: 1 };
      }),
      deleteOne: vi.fn(async () => {
        document = undefined;
      }),
    } as unknown as MongoLockCollection;
  }

  it('refuses a live Mongo lock and claims one whose expiresAt has passed', async () => {
    const live = lockCollection(new Date(Date.now() + 60_000));
    await expect(withMongoMigrationLock(live, 'migration', async () => 'done')).rejects.toBeInstanceOf(
      DbConfigError,
    );
    expect(live.createIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    const expired = lockCollection(new Date(Date.now() - 1_000));
    await expect(withMongoMigrationLock(expired, 'migration', async () => 'done')).resolves.toBe('done');
    expect(expired.replaceOne).toHaveBeenCalled();
  });

  it('creates a fresh Mongo lock when none exists', async () => {
    const collection = lockCollection();

    await expect(withMongoMigrationLock(collection, 'migration', async () => 'done')).resolves.toBe('done');
    expect(collection.insertOne).toHaveBeenCalled();
    expect(collection.deleteOne).toHaveBeenCalled();
  });
});

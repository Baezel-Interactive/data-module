import type { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DbConfigError,
  loadEntitiesFromGlob,
  normalizeRegistration,
  resolveConnector,
  resolveEntities,
  type ConnectorFactoryContext,
  type IDbConnector,
  type IRepository,
} from '../src/index.js';
import { discoverDecoratedEntities } from '../src/typeorm/index.js';

const ENTITY_GLOB = 'test/fixtures/entities/*.entity.js';

const metadataMocks = vi.hoisted(() => ({
  tables: [] as Array<{ target: unknown }>,
}));

vi.mock('typeorm', () => ({
  DataSource: class {},
  getMetadataArgsStorage: () => ({ tables: metadataMocks.tables }),
}));

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

  return {
    driver: 'postgres',
    config: { host: 'localhost', database: 'app' },
    safety: {
      allowSchemaSync: false,
      allowDropSchema: false,
      allowDropDatabase: false,
      allowDestructiveMigrations: false,
      allowInsecureTls: false,
      exposeDataSource: false,
      allowSeed: false,
    },
    provisioning: { createIfMissing: false },
    entities: { glob: [], discoverDecorators: false },
    pool: {},
    timeouts: {},
    resilience: { retries: 2, backoffMs: 50, breakerThreshold: 5, breakerHalfOpenMs: 10_000 },
    driverOptions: {},
    environment: 'development',
    hooks: undefined,
    logger,
    ...overrides,
  };
}

describe('entity autoload', () => {
  beforeEach(() => {
    metadataMocks.tables.length = 0;
  });

  it('loads and deduplicates exported classes from glob patterns', async () => {
    const result = await loadEntitiesFromGlob([ENTITY_GLOB, ENTITY_GLOB]);

    expect(result.files).toBe(2);
    expect(result.targets.map((target) => target.name).sort()).toEqual(['PostEntity', 'UserEntity']);
  });

  it('resolves glob entities, logs the count and records sources', async () => {
    const context = createContext({ entities: { glob: [ENTITY_GLOB], discoverDecorators: false } });

    const resolved = await resolveEntities(context);

    expect(resolved?.targets).toHaveLength(2);
    expect(resolved?.sources).toEqual({ glob: 2, decorators: 0, files: 2 });
    expect(vi.mocked(context.logger.log)).toHaveBeenCalledWith(expect.stringContaining('Resolved 2 entities'));
  });

  it('discovers entities from TypeORM decorator metadata', async () => {
    class DecoratedEntity {}
    metadataMocks.tables.push({ target: DecoratedEntity }, { target: 'StringEntity' });

    const discovered = discoverDecoratedEntities();
    expect(discovered).toEqual([DecoratedEntity]);

    const resolved = await resolveEntities(createContext({ entities: { glob: [], discoverDecorators: true } }));
    expect(resolved?.targets).toEqual([DecoratedEntity]);
    expect(resolved?.sources.decorators).toBe(1);
  });

  it('rejects TypeScript glob patterns', async () => {
    await expect(loadEntitiesFromGlob(['dist/**/*.entity.ts'])).rejects.toBeInstanceOf(DbConfigError);
  });

  it('fails fast when a SQL driver finds no entities', async () => {
    const context = createContext({
      entities: { glob: ['test/fixtures/entities/none-*.js'], discoverDecorators: false },
    });

    await expect(resolveEntities(context)).rejects.toBeInstanceOf(DbConfigError);
  });

  it('allows zero entities for Mongo', async () => {
    const context = createContext({
      driver: 'mongodb',
      entities: { glob: ['test/fixtures/entities/none-*.js'], discoverDecorators: false },
    });

    await expect(resolveEntities(context)).resolves.toEqual({
      targets: [],
      sources: { glob: 0, decorators: 0, files: 0 },
    });
  });

  it('passes resolved entities to the connector factory', async () => {
    const factory = vi.fn((context: ConnectorFactoryContext) => {
      expect(context.resolvedEntities?.targets).toHaveLength(2);
      return connector;
    });

    const registration = normalizeRegistration({
      kind: 'driver',
      driver: 'postgres',
      config: { host: 'localhost', database: 'app' },
      provisioning: { createIfMissing: false },
      entities: { glob: [ENTITY_GLOB], discoverDecorators: false },
      connectorFactory: factory,
    });

    expect(await resolveConnector(registration)).toBe(connector);
    expect(factory).toHaveBeenCalledOnce();
  });
});

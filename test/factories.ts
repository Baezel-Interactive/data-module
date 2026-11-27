import { describe, expect, it } from 'vitest';
import {
  createConnectorFactoryContext,
  createConnectorFromDbOptions,
  DbDependencyError,
  parseDbOptions,
} from '../src/index.js';
import { MongoConnector } from '../src/mongo/index.js';
import { PrismaConnector } from '../src/prisma/index.js';
import { TypeOrmConnector, createTypeOrmDataSourceOptions } from '../src/typeorm/index.js';

const base = {
  driver: 'postgres' as const,
  config: { host: 'localhost', database: 'app', username: 'user', password: 'secret' },
  provisioning: { createIfMissing: false },
};

const failingLoaders = {
  typeorm: async () => {
    throw new Error('missing');
  },
  mongo: async () => {
    throw new Error('missing');
  },
  prisma: async () => {
    throw new Error('missing');
  },
  typeormFactory: async () => {
    throw new Error('missing');
  },
};

describe('connector factories', () => {
  it('maps dbOptions to TypeORM DataSourceOptions', () => {
    const options = createTypeOrmDataSourceOptions(parseDbOptions(base)) as {
      type: string;
      migrations: string[];
      migrationsTableName: string;
      entities: unknown[];
    };

    expect(options.type).toBe('postgres');
    expect(options.migrations).toEqual(['migrations/*.ts', 'migrations/*.js']);
    expect(options.migrationsTableName).toBe('migrations');
    expect(options.entities).toEqual([]);
  });

  it('scaffolds TypeORM, Mongo and Prisma connectors from dbOptions', async () => {
    const typeOrmContext = createConnectorFactoryContext(parseDbOptions(base));
    expect(await createConnectorFromDbOptions(typeOrmContext)).toBeInstanceOf(TypeOrmConnector);

    const mongoOptions = parseDbOptions({ driver: 'mongodb', config: { url: 'mongodb://localhost/app' } });
    expect(await createConnectorFromDbOptions(createConnectorFactoryContext(mongoOptions))).toBeInstanceOf(
      MongoConnector,
    );

    const client = { $connect: async () => undefined, $disconnect: async () => undefined };
    const prismaOptions = parseDbOptions({
      driver: 'postgres',
      orm: 'prisma',
      config: {},
      prisma: { client },
    });
    expect(await createConnectorFromDbOptions(createConnectorFactoryContext(prismaOptions))).toBeInstanceOf(
      PrismaConnector,
    );
  });

  it('requires a client for Prisma', () => {
    expect(() => parseDbOptions({ driver: 'postgres', orm: 'prisma', config: {} })).toThrow(/prisma.client/);
  });

  it('throws typed dependency errors with driver-specific install hints', async () => {
    const cases = [
      { dbOptions: base, hint: 'npm install typeorm pg' },
      { dbOptions: { ...base, driver: 'mysql' as const }, hint: 'npm install typeorm mysql2' },
      {
        dbOptions: { driver: 'mongodb' as const, config: { url: 'mongodb://localhost/app' } },
        hint: 'npm install mongodb',
      },
      {
        dbOptions: {
          driver: 'postgres' as const,
          orm: 'prisma' as const,
          config: {},
          prisma: { client: { $connect: async () => undefined, $disconnect: async () => undefined } },
        },
        hint: 'npm install @prisma/client',
      },
    ];

    for (const testCase of cases) {
      const context = createConnectorFactoryContext(parseDbOptions(testCase.dbOptions));
      await expect(createConnectorFromDbOptions(context, failingLoaders)).rejects.toBeInstanceOf(
        DbDependencyError,
      );
      await expect(createConnectorFromDbOptions(context, failingLoaders)).rejects.toMatchObject({
        code: 'DRIVER_MISSING',
      });
      await expect(createConnectorFromDbOptions(context, failingLoaders)).rejects.toThrow(testCase.hint);
    }
  });
});

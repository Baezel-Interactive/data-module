import { describe, expect, it } from 'vitest';
import { createConnectorFactoryContext, createConnectorFromDbOptions, parseDbOptions } from '../src/index.js';
import { MongoConnector } from '../src/mongo/index.js';
import { PrismaConnector } from '../src/prisma/index.js';
import { TypeOrmConnector, createTypeOrmDataSourceOptions } from '../src/typeorm/index.js';

const base = {
  driver: 'postgres' as const,
  config: { host: 'localhost', database: 'app', username: 'user', password: 'secret' },
  provisioning: { createIfMissing: false },
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

  it('scaffolds TypeORM, Mongo and Prisma connectors from dbOptions', () => {
    const typeOrmContext = createConnectorFactoryContext(parseDbOptions(base));
    expect(createConnectorFromDbOptions(typeOrmContext)).toBeInstanceOf(TypeOrmConnector);

    const mongoOptions = parseDbOptions({ driver: 'mongodb', config: { url: 'mongodb://localhost/app' } });
    expect(createConnectorFromDbOptions(createConnectorFactoryContext(mongoOptions))).toBeInstanceOf(
      MongoConnector,
    );

    const client = { $connect: async () => undefined, $disconnect: async () => undefined };
    const prismaOptions = parseDbOptions({
      driver: 'postgres',
      orm: 'prisma',
      config: {},
      prisma: { client },
    });
    expect(createConnectorFromDbOptions(createConnectorFactoryContext(prismaOptions))).toBeInstanceOf(
      PrismaConnector,
    );
  });

  it('requires a client for Prisma', () => {
    expect(() => parseDbOptions({ driver: 'postgres', orm: 'prisma', config: {} })).toThrow(/prisma.client/);
  });
});

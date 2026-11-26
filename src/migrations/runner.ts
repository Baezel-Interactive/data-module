import { readFileSync } from 'node:fs';
import type { Logger } from '@nestjs/common';
import type { Collection, Document } from 'mongodb';
import type { ConnectorFactoryContext, DbDriver } from '../config/index.js';
import { loadModulesFromGlob } from '../entities/glob.js';
import { DbConfigError } from '../errors/index.js';
import {
  migrationChecksum,
  withMongoMigrationLock,
  withMysqlMigrationLock,
  withPostgresAdvisoryLock,
  type MongoLockCollection,
} from '../safety/index.js';
import { resolveConnectionSettings } from '../provisioning/index.js';
import { guardDestructiveSql } from '../safety/index.js';

export interface MigrationContext {
  driver: DbDriver;
  logger: Logger;
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
  collection(name: string): Collection<Document>;
}

export interface MigrationModule {
  up(context: MigrationContext): Promise<void>;
  down?(context: MigrationContext): Promise<void>;
}

export interface MigrationFile {
  name: string;
  checksum: string;
  module: MigrationModule;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  appliedAt: string;
}

export interface MigrationStore {
  init(): Promise<void>;
  applied(): Promise<AppliedMigration[]>;
  record(state: AppliedMigration): Promise<void>;
  withLock<T>(work: () => Promise<T>): Promise<T>;
  context: MigrationContext;
}

export interface MigrationStatus {
  name: string;
  checksum: string;
  status: 'applied' | 'pending';
  changed: boolean;
}

function lockKey(name: string): number {
  return Number.parseInt(migrationChecksum(name).slice(0, 8), 16);
}

export async function discoverMigrations(patterns: string[]): Promise<MigrationFile[]> {
  const modules = await loadModulesFromGlob(patterns, true);
  return modules
    .map((loaded) => {
      const value = loaded.exports.up ?? loaded.exports.default;
      const up = value && typeof value === 'object' ? (value as MigrationModule).up : value;
      if (typeof up !== 'function') {
        throw new DbConfigError('Migration files must export an up() function', {
          details: { file: loaded.file },
        });
      }
      return {
        name: loaded.file.split(/[\\/]/).pop() ?? loaded.file,
        checksum: migrationChecksum(readFileSync(loaded.file, 'utf8')),
        module: { up: up as MigrationModule['up'] },
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function statusOfMigrations(patterns: string[], store?: MigrationStore): Promise<MigrationStatus[]> {
  const files = await discoverMigrations(patterns);
  const applied = store ? await store.applied() : [];
  return files.map((file) => {
    const existing = applied.find((entry) => entry.name === file.name);
    return {
      name: file.name,
      checksum: file.checksum,
      status: existing ? 'applied' : 'pending',
      changed: existing ? existing.checksum !== file.checksum : false,
    };
  });
}

async function createSqlStore(
  context: ConnectorFactoryContext,
  driver: 'postgres' | 'mysql',
): Promise<MigrationStore> {
  const settings = resolveConnectionSettings(context.config, driver);
  const placeholders = driver === 'postgres' ? ['$1', '$2', '$3'] : ['?', '?', '?'];
  const table = 'baezel_migrations';
  const pool = context.pool;

  if (driver === 'postgres') {
    const { Client } = await import('pg');
    const client = new Client({
      host: settings.host,
      port: settings.port ?? 5432,
      user: settings.username,
      password: settings.password,
      database: settings.database,
      connectionTimeoutMillis: context.timeouts.connectMs,
    });
    await client.connect();
    const query = async (sql: string, parameters?: unknown[]) => {
      guardDestructiveSql(sql, context);
      return client.query(sql, parameters);
    };
    return {
      context: {
        driver,
        logger: context.logger,
        query,
        collection: () => {
          throw new DbConfigError('Mongo collections are unavailable for SQL drivers');
        },
      },
      init: async () => {
        await query(
          `CREATE TABLE IF NOT EXISTS ${table} (name VARCHAR(255) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, applied_at VARCHAR(64) NOT NULL)`,
        );
      },
      applied: async () => {
        const result = await query(`SELECT name, checksum, applied_at FROM ${table}`);
        return (result as { rows?: AppliedMigration[] }).rows ?? [];
      },
      record: async (state) => {
        await query(`INSERT INTO ${table} (name, checksum, applied_at) VALUES (${placeholders.join(', ')})`, [
          state.name,
          state.checksum,
          state.appliedAt,
        ]);
      },
      withLock: <T>(work: () => Promise<T>) => withPostgresAdvisoryLock(client, lockKey(settings.database), work),
    };
  }

  const { createConnection } = await import('mysql2/promise');
  const connection = await createConnection({
    host: settings.host,
    port: settings.port ?? 3306,
    user: settings.username,
    password: settings.password,
    database: settings.database,
    connectTimeout: context.timeouts.connectMs,
    connectionLimit: pool.max,
  });
  const query = (sql: string, parameters?: unknown[]) => {
    guardDestructiveSql(sql, context);
    return connection.query(sql, parameters);
  };
  return {
    context: {
      driver,
      logger: context.logger,
      query: async (sql, parameters) => {
        await query(sql, parameters);
      },
      collection: () => {
        throw new DbConfigError('Mongo collections are unavailable for SQL drivers');
      },
    },
    init: async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS ${table} (name VARCHAR(255) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, applied_at VARCHAR(64) NOT NULL)`,
      );
    },
    applied: async () => {
      const [rows] = await query(`SELECT name, checksum, applied_at FROM ${table}`);
      return (rows ?? []) as AppliedMigration[];
    },
    record: async (state) => {
      await query(`INSERT INTO ${table} (name, checksum, applied_at) VALUES (${placeholders.join(', ')})`, [
        state.name,
        state.checksum,
        state.appliedAt,
      ]);
    },
    withLock: <T>(work: () => Promise<T>) =>
      withMysqlMigrationLock(connection, `baezel:${settings.database}`, work),
  };
}

async function createMongoStore(context: ConnectorFactoryContext): Promise<MigrationStore> {
  const { MongoClient } = await import('mongodb');
  const settings = resolveConnectionSettings(context.config, 'mongodb');
  const url = settings.url ?? `mongodb://${settings.host ?? 'localhost'}:${settings.port ?? 27017}`;
  const client = new MongoClient(url);
  await client.connect();
  const database = client.db(settings.database);
  const migrations = database.collection<Document>('baezel_migrations');
  const lockCollection = database.collection('baezel_migration_lock') as unknown as MongoLockCollection;

  return {
    context: {
      driver: 'mongodb',
      logger: context.logger,
      query: async () => {
        throw new DbConfigError('SQL queries are unavailable for Mongo migrations');
      },
      collection: (name) => database.collection<Document>(name),
    },
    init: async () => {
      await migrations.createIndex({ name: 1 }, { unique: true });
    },
    applied: async () => (await migrations.find({}).toArray()) as unknown as AppliedMigration[],
    record: async (state) => {
      await migrations.insertOne(state as unknown as Document);
    },
    withLock: <T>(work: () => Promise<T>) =>
      withMongoMigrationLock(lockCollection, `baezel:${settings.database}`, work),
  };
}

export function createMigrationStore(context: ConnectorFactoryContext): Promise<MigrationStore> {
  if (context.driver === 'mongodb') {
    return createMongoStore(context);
  }
  return createSqlStore(context, context.driver);
}

export async function runMigrations(
  context: ConnectorFactoryContext,
  patterns: string[],
): Promise<MigrationStatus[]> {
  const files = await discoverMigrations(patterns);
  const store = await createMigrationStore(context);
  await context.hooks?.onEvent?.({ type: 'migration:start', timestamp: Date.now(), driver: context.driver });

  await store.withLock(async () => {
    await store.init();
    const applied = await store.applied();
    for (const file of files) {
      const existing = applied.find((entry) => entry.name === file.name);
      if (existing) {
        if (existing.checksum !== file.checksum) {
          throw new DbConfigError(`Migration ${file.name} was edited after being applied`, {
            details: { name: file.name },
          });
        }
        continue;
      }
      await file.module.up(store.context);
      await store.record({ name: file.name, checksum: file.checksum, appliedAt: new Date().toISOString() });
    }
  });

  await context.hooks?.onEvent?.({ type: 'migration:complete', timestamp: Date.now(), driver: context.driver });
  return statusOfMigrations(patterns, store);
}

export async function runSeeds(context: ConnectorFactoryContext, patterns: string[]): Promise<string[]> {
  const { assertDestructiveOperation } = await import('../safety/policy.js');
  assertDestructiveOperation(context, 'seed');
  const modules = await loadModulesFromGlob(patterns, true);
  const store = await createMigrationStore(context);
  const seeded: string[] = [];
  for (const loaded of modules) {
    const seed = loaded.exports.seed ?? loaded.exports.up;
    if (typeof seed !== 'function') {
      throw new DbConfigError('Seed files must export a seed() or up() function', {
        details: { file: loaded.file },
      });
    }
    await (seed as MigrationModule['up'])(store.context);
    seeded.push(loaded.file.split(/[\\/]/).pop() ?? loaded.file);
  }
  return seeded;
}

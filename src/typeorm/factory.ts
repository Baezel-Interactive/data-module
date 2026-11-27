import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';
import { parseDbOptions, resolveMigrationPatterns, type DbOptionsInput } from '../config/schema.js';
import { DbConfigError } from '../errors/index.js';

export interface TypeOrmDataSourceFactoryOptions {
  entities?: Array<new () => unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function createTypeOrmDataSourceOptions(
  input: DbOptionsInput,
  factoryOptions: TypeOrmDataSourceFactoryOptions = {},
): DataSourceOptions {
  const dbOptions = parseDbOptions(input);
  const { config, driver, pool, timeouts } = dbOptions;
  const url = optionalString(config.url);
  const database = optionalString(config.database);
  const host = optionalString(config.host);
  const port = optionalNumber(config.port);
  const username = optionalString(config.username) ?? optionalString(config.user);
  const password = optionalString(config.password);

  if (!url && !host) {
    throw new DbConfigError('TypeORM requires either config.url or config.host');
  }

  const connectTimeout = timeouts.connectMs ?? pool.acquireTimeoutMs;
  const statementTimeout = timeouts.queryMs ?? pool.statementTimeoutMs;

  const base = {
    type: driver === 'postgres' ? ('postgres' as const) : ('mysql' as const),
    url,
    host,
    port,
    username,
    password,
    database,
    entities: factoryOptions.entities ?? [],
    synchronize: false,
    dropSchema: false,
    migrations: resolveMigrationPatterns(dbOptions),
    migrationsTableName: dbOptions.migrations.tableName,
    migrationsRun: false,
  };

  if (driver === 'postgres') {
    return {
      ...base,
      extra: {
        max: pool.max,
        connectionTimeoutMillis: connectTimeout,
        idleTimeoutMillis: pool.idleTimeoutMs,
        query_timeout: statementTimeout,
      },
    } as DataSourceOptions;
  }

  return {
    ...base,
    poolSize: pool.max,
    connectTimeout,
    acquireTimeout: connectTimeout,
    idleTimeout: pool.idleTimeoutMs,
  } as DataSourceOptions;
}

export function createTypeOrmDataSource(
  input: DbOptionsInput,
  factoryOptions: TypeOrmDataSourceFactoryOptions = {},
): DataSource {
  return new DataSource(createTypeOrmDataSourceOptions(input, factoryOptions));
}

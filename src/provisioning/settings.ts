import { z } from 'zod';
import type { DbDriver } from '../config/index.js';
import { DbConfigError } from '../errors/index.js';

const connectionSchema = z
  .object({
    url: z.string().min(1).optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().positive().optional(),
    database: z.string().min(1).optional(),
    username: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    maintenanceDatabase: z.string().min(1).optional(),
    ssl: z.unknown().optional(),
  })
  .passthrough();

export interface ConnectionSettings {
  url?: string;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  maintenanceDatabase?: string;
  ssl?: boolean | Record<string, unknown>;
}

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const MONGO_DATABASE = /^[A-Za-z0-9_-]+$/;

export function validateDatabaseName(database: string, driver: DbDriver): string {
  const pattern = driver === 'mongodb' ? MONGO_DATABASE : SQL_IDENTIFIER;
  if (!pattern.test(database)) {
    throw new DbConfigError(`Invalid ${driver} database name`, { details: { field: 'database' } });
  }
  return database;
}

export function quoteSqlIdentifier(identifier: string, quote: '"' | '`'): string {
  return `${quote}${identifier.split(quote).join(quote + quote)}${quote}`;
}

export function resolveConnectionSettings(config: Record<string, unknown>, driver: DbDriver): ConnectionSettings {
  const parsed = connectionSchema.safeParse(config);
  if (!parsed.success) {
    throw new DbConfigError('Invalid database connection configuration', {
      details: {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
  }

  const data = parsed.data;
  let { host, port, database, password } = data;
  let username = data.username ?? data.user;

  if (data.url) {
    let url: URL;
    try {
      url = new URL(data.url);
    } catch {
      throw new DbConfigError('Invalid database connection URL', { details: { field: 'url' } });
    }
    host ??= url.hostname || undefined;
    port ??= url.port ? Number(url.port) : undefined;
    database ??= decodeURIComponent(url.pathname.replace(/^\//, '')) || undefined;
    username ??= decodeURIComponent(url.username) || undefined;
    password ??= decodeURIComponent(url.password) || undefined;
  }

  if (!database) {
    throw new DbConfigError('A database name is required for provisioning', { details: { field: 'database' } });
  }
  if (!host && !data.url) {
    throw new DbConfigError('A host or connection URL is required for provisioning', {
      details: { field: 'host' },
    });
  }

  validateDatabaseName(database, driver);

  return {
    url: data.url,
    host,
    port,
    database,
    username,
    password,
    maintenanceDatabase: data.maintenanceDatabase,
    ssl:
      typeof data.ssl === 'boolean' || (data.ssl !== null && typeof data.ssl === 'object')
        ? (data.ssl as boolean | Record<string, unknown>)
        : undefined,
  };
}

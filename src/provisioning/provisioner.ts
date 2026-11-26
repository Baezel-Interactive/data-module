import type { ConnectorFactoryContext, DbDriver } from '../config/index.js';
import { DbConfigError, DbConnectionError, normalizeDbError } from '../errors/index.js';
import { createErrorHookEvent, type HookEvent, type Hooks } from '../hooks/index.js';
import { quoteSqlIdentifier, resolveConnectionSettings, type ConnectionSettings } from './settings.js';

const DEFAULT_TIMEOUT_MS = 5000;

interface RetryContext {
  timeoutMs: number;
  retries: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DbConnectionError('Database provisioning timed out', { code: 'CONNECTION_TIMEOUT' })),
      ms,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

async function withRetry<T>(operation: () => Promise<T>, context: RetryContext): Promise<T> {
  const deadline = Date.now() + context.timeoutMs;
  let attempt = 0;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new DbConnectionError('Database provisioning timed out', { code: 'CONNECTION_TIMEOUT' });
    }

    try {
      return await withTimeout(operation(), remaining);
    } catch (error) {
      const normalized = error instanceof DbConfigError ? error : normalizeDbError(error, 'provisioning');
      const retryable =
        normalized.kind === 'connection' ||
        normalized.code === 'TRANSIENT_TRANSACTION_ERROR' ||
        normalized.code === 'SERIALIZATION_FAILURE';

      if (!retryable || attempt >= context.retries || Date.now() >= deadline) {
        throw normalized;
      }

      const wait = Math.min(100 * 2 ** attempt, Math.max(0, deadline - Date.now()));
      attempt += 1;
      if (wait > 0) {
        await delay(wait);
      }
    }
  }
}

async function emitEvent(
  hooks: Hooks | undefined,
  onFailure: (message: string) => void,
  event: HookEvent,
): Promise<void> {
  try {
    await hooks?.onEvent?.(event);
  } catch {
    onFailure('A database hook failed');
  }
}

async function emitError(
  hooks: Hooks | undefined,
  onFailure: (message: string) => void,
  error: unknown,
): Promise<void> {
  try {
    await hooks?.onError?.(createErrorHookEvent(error, 'provisioning'));
  } catch {
    onFailure('A database error hook failed');
  }
}

function baseEvent(context: ConnectorFactoryContext, type: HookEvent['type'], durationMs?: number): HookEvent {
  return { type, timestamp: Date.now(), driver: context.driver, connector: 'provisioner', durationMs };
}

async function connectPostgres(
  settings: ConnectionSettings,
  timeoutMs: number,
): Promise<{ client: import('pg').Client; maintenance: string }> {
  const { Client } = await import('pg');
  const candidates = [...new Set([settings.maintenanceDatabase ?? 'postgres', 'template1'])];
  let lastError: ReturnType<typeof normalizeDbError> | undefined;

  for (const maintenance of candidates) {
    const client = new Client({
      host: settings.host,
      port: settings.port ?? 5432,
      user: settings.username,
      password: settings.password,
      database: maintenance,
      connectionTimeoutMillis: timeoutMs,
      ssl: settings.ssl as never,
    });

    try {
      await client.connect();
      return { client, maintenance };
    } catch (error) {
      lastError = normalizeDbError(error, 'provisioning');
      await client.end().catch(() => undefined);
      if (lastError.code !== 'DATABASE_NOT_FOUND' || maintenance === candidates[candidates.length - 1]) {
        break;
      }
    }
  }

  throw lastError ?? new DbConnectionError('Could not connect to Postgres', { code: 'CONNECTION_FAILED' });
}

async function provisionPostgres(context: ConnectorFactoryContext, settings: ConnectionSettings): Promise<void> {
  const { client } = await connectPostgres(settings, context.provisioning.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const logger = context.logger;

  try {
    const check = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [settings.database]);
    if (check.rowCount !== 0) {
      return;
    }

    try {
      await client.query(`CREATE DATABASE ${quoteSqlIdentifier(settings.database, '"')}`);
      logger.log(`Database "${settings.database}" did not exist; created it.`);
    } catch (error) {
      const normalized = normalizeDbError(error, 'provisioning');
      if (normalized.code !== 'DATABASE_EXISTS') {
        throw normalized;
      }
      logger.log(`Database "${settings.database}" was created by another process.`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function provisionMysql(context: ConnectorFactoryContext, settings: ConnectionSettings): Promise<void> {
  const { createConnection } = await import('mysql2/promise');
  const connection = await createConnection({
    host: settings.host,
    port: settings.port ?? 3306,
    user: settings.username,
    password: settings.password,
    connectTimeout: context.provisioning.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ssl: settings.ssl as never,
  });

  try {
    const [rows] = await connection.query(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [settings.database],
    );
    if (Array.isArray(rows) && rows.length > 0) {
      return;
    }

    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteSqlIdentifier(settings.database, '`')} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    context.logger.log(`Database "${settings.database}" did not exist; created it.`);
  } finally {
    await connection.end().catch(() => undefined);
  }
}

function mongoUrl(settings: ConnectionSettings): string {
  if (settings.url) {
    return settings.url;
  }
  const credentials =
    settings.username || settings.password
      ? `${encodeURIComponent(settings.username ?? '')}:${encodeURIComponent(settings.password ?? '')}@`
      : '';
  return `mongodb://${credentials}${settings.host}:${settings.port ?? 27017}`;
}

async function provisionMongo(context: ConnectorFactoryContext, settings: ConnectionSettings): Promise<void> {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(mongoUrl(settings), {
    serverSelectionTimeoutMS: context.provisioning.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  try {
    await client.connect();
    await client.db(settings.database).command({ ping: 1 });
    context.logger.log(
      `MongoDB database "${settings.database}" is created lazily on first write; no explicit create was performed.`,
    );
  } finally {
    await client.close();
  }
}

async function provisionDriver(
  context: ConnectorFactoryContext,
  settings: ConnectionSettings,
  driver: DbDriver,
): Promise<void> {
  if (driver === 'postgres') {
    await provisionPostgres(context, settings);
  } else if (driver === 'mysql') {
    await provisionMysql(context, settings);
  } else {
    await provisionMongo(context, settings);
  }
}

export async function provisionDatabase(context: ConnectorFactoryContext): Promise<void> {
  const configured = context.provisioning.createIfMissing;
  const onFailure = (message: string) => context.logger.warn(message);

  if (configured === true && context.driver === 'mongodb') {
    context.logger.warn('createIfMissing is SQL-only; MongoDB creates databases lazily on first write.');
  }

  const enabled = configured === undefined ? context.environment !== 'production' : configured;
  if (!enabled) {
    return;
  }

  const settings = resolveConnectionSettings(context.config, context.driver);
  const timeoutMs = context.provisioning.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = context.provisioning.retries ?? 2;
  const started = Date.now();
  await emitEvent(context.hooks, onFailure, baseEvent(context, 'provisioning:start'));

  try {
    await withRetry(() => provisionDriver(context, settings, context.driver), { timeoutMs, retries });
    await emitEvent(context.hooks, onFailure, baseEvent(context, 'provisioning:complete', Date.now() - started));
  } catch (error) {
    const normalized = error instanceof DbConfigError ? error : normalizeDbError(error, 'provisioning');
    await emitError(context.hooks, onFailure, normalized);
    throw normalized;
  }
}

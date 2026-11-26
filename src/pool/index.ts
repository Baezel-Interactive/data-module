import type { DbDriver, DbPoolOptions, DbTimeoutsOptions } from '../config/index.js';

export function mapPoolOptions(
  driver: DbDriver,
  pool: DbPoolOptions,
  timeouts: DbTimeoutsOptions,
): Record<string, unknown> {
  const connect = timeouts.connectMs ?? pool.acquireTimeoutMs;

  if (driver === 'postgres') {
    return {
      min: pool.min,
      max: pool.max,
      connectionTimeoutMillis: connect,
      idleTimeoutMillis: pool.idleTimeoutMs,
      query_timeout: timeouts.queryMs ?? pool.statementTimeoutMs,
    };
  }

  if (driver === 'mysql') {
    return {
      connectionLimit: pool.max,
      waitForConnections: true,
      acquireTimeout: connect,
      connectTimeout: connect,
      idleTimeout: pool.idleTimeoutMs,
    };
  }

  return {
    minPoolSize: pool.min,
    maxPoolSize: pool.max,
    serverSelectionTimeoutMS: connect,
    socketTimeoutMS: timeouts.queryMs ?? pool.statementTimeoutMs,
  };
}

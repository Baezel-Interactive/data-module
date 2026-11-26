import { DbConfigError } from '../errors/index.js';

export interface PgQueryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export async function withPostgresAdvisoryLock<T>(
  client: PgQueryable,
  key: number,
  work: () => Promise<T>,
): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [key]);
  try {
    return await work();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [key]);
  }
}

export interface MysqlQueryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export async function withMysqlMigrationLock<T>(
  connection: MysqlQueryable,
  name: string,
  work: () => Promise<T>,
  timeoutSeconds = 10,
): Promise<T> {
  const [rows] = (await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [name, timeoutSeconds])) as [
    Array<{ acquired?: number }>,
    unknown,
  ];
  if (rows?.[0]?.acquired !== 1) {
    throw new DbConfigError('Could not acquire the MySQL migration lock');
  }

  try {
    return await work();
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [name]);
  }
}

export interface MongoLockDocument {
  name: string;
  expiresAt: Date;
  [key: string]: unknown;
}

export interface MongoLockCollection {
  createIndex(index: Record<string, number>, options: Record<string, unknown>): Promise<unknown>;
  insertOne(document: MongoLockDocument): Promise<unknown>;
  findOne(filter: Record<string, unknown>): Promise<MongoLockDocument | null>;
  replaceOne(filter: Record<string, unknown>, replacement: MongoLockDocument): Promise<{ modifiedCount?: number }>;
  deleteOne(filter: Record<string, unknown>): Promise<unknown>;
}

export interface MongoLockOptions {
  leaseMs?: number;
  heartbeatMs?: number;
}

export async function ensureMongoLockIndexes(collection: MongoLockCollection): Promise<void> {
  await collection.createIndex({ name: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function withMongoMigrationLock<T>(
  collection: MongoLockCollection,
  name: string,
  work: () => Promise<T>,
  options: MongoLockOptions = {},
): Promise<T> {
  await ensureMongoLockIndexes(collection);

  const leaseMs = options.leaseMs ?? 30_000;
  const heartbeatMs = options.heartbeatMs ?? 5_000;
  let currentExpiry = new Date(Date.now() + leaseMs);
  let acquired = false;

  try {
    try {
      await collection.insertOne({ name, expiresAt: currentExpiry });
      acquired = true;
    } catch {
      const existing = await collection.findOne({ name });
      const isExpired =
        existing !== null && existing.expiresAt instanceof Date && existing.expiresAt.getTime() <= Date.now();
      if (!isExpired || !existing) {
        throw new DbConfigError('The Mongo migration lock is held');
      }
      const claimed = await collection.replaceOne(
        { name, expiresAt: existing.expiresAt },
        { name, expiresAt: currentExpiry },
      );
      if (!claimed.modifiedCount) {
        throw new DbConfigError('The Mongo migration lock is held');
      }
      acquired = true;
      currentExpiry = new Date(Date.now() + leaseMs);
    }

    const heartbeat = setInterval(() => {
      const next = new Date(Date.now() + leaseMs);
      void collection
        .replaceOne({ name, expiresAt: currentExpiry }, { name, expiresAt: next })
        .then((result) => {
          if (result.modifiedCount) {
            currentExpiry = next;
          }
        })
        .catch(() => undefined);
    }, heartbeatMs);
    heartbeat.unref?.();

    try {
      return await work();
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    if (acquired) {
      await collection.deleteOne({ name, expiresAt: currentExpiry }).catch(() => undefined);
    }
  }
}

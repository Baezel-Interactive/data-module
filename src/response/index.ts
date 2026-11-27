import { createHash } from 'node:crypto';
import type { DbIdentityOptions, DbRedactionOptions } from '../config/schema.js';
import { DbConfigError } from '../errors/index.js';
import type { DbId, IRepository, RepositoryOptions } from '../interfaces/index.js';

export interface ResponseShapeOptions {
  identity: DbIdentityOptions;
  redaction: DbRedactionOptions;
}

export function uuidv5(value: string | number, namespace: string, tableName?: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const name = tableName ? `${tableName}:${String(value)}` : String(value);
  const hash = createHash('sha1')
    .update(Buffer.concat([namespaceBytes, Buffer.from(name, 'utf8')]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cloneValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = cloneValue(item);
  }
  return result;
}

function deletePath(target: Record<string, unknown>, dottedPath: string): void {
  const parts = dottedPath.split('.');
  let current: unknown = target;
  for (const part of parts.slice(0, -1)) {
    if (current === null || typeof current !== 'object') {
      return;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current !== null && typeof current === 'object') {
    delete (current as Record<string, unknown>)[parts[parts.length - 1]];
  }
}

export function mapResponse<T>(row: T, shape: ResponseShapeOptions, tableName?: string): T {
  if (row === null || row === undefined) {
    return row;
  }
  const result = cloneValue(row) as Record<string, unknown>;
  const numericId = result.id;

  if (shape.identity.strategy === 'uuid') {
    const storedUuid = result[shape.identity.uuidColumn];
    const idSource =
      numericId === undefined || numericId === null
        ? (JSON.stringify(result) ?? '')
        : (numericId as string | number);
    const derived =
      typeof storedUuid === 'string' && storedUuid.length > 0
        ? storedUuid
        : uuidv5(idSource, shape.identity.namespace, tableName);
    delete result.id;
    Object.defineProperty(result, 'id', { value: derived, enumerable: true, configurable: true, writable: true });
    Object.defineProperty(result, shape.identity.numericIdProperty, {
      value: numericId,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  for (const field of shape.redaction.fields) {
    deletePath(result, field);
  }
  return result as T;
}

function withIdentityOptions(
  options: RepositoryOptions | undefined,
  shape: ResponseShapeOptions,
  tableName?: string,
): RepositoryOptions | undefined {
  if (shape.identity.strategy !== 'uuid') {
    return options;
  }
  return { ...options, idField: shape.identity.uuidColumn, idType: 'string', uuidTable: tableName };
}

async function ensureUuid<T>(
  row: T,
  repository: IRepository<T>,
  shape: ResponseShapeOptions,
  tableName?: string,
): Promise<T> {
  if (shape.identity.strategy !== 'uuid' || row === null || row === undefined) {
    return row;
  }
  const record = row as Record<string, unknown>;
  if (typeof record[shape.identity.uuidColumn] === 'string') {
    return row;
  }
  const numericId = record.id ?? record[shape.identity.numericIdProperty];
  if (numericId === undefined || numericId === null) {
    return row;
  }
  const derived = uuidv5(numericId as string | number, shape.identity.namespace, tableName);
  const withUuid = { ...record, [shape.identity.uuidColumn]: derived } as T;
  const write = async (target: IRepository<T>): Promise<T> => {
    await target.update(numericId as DbId, { [shape.identity.uuidColumn]: derived } as Partial<T>, {
      idField: 'id',
    });
    return withUuid;
  };
  if (!repository.transaction) {
    throw new DbConfigError('UUID identity requires a connector with repository transaction support');
  }
  return repository.transaction(write);
}

export function shapeRepository<T>(
  repository: IRepository<T>,
  shape: ResponseShapeOptions,
  tableName?: string,
): IRepository<T> {
  const identityOptions = (options?: RepositoryOptions) => withIdentityOptions(options, shape, tableName);

  return {
    findMany: async (options) =>
      (await repository.findMany(options)).map((row) => mapResponse(row, shape, tableName)),
    findOne: async (id, options) =>
      mapResponse(await repository.findOne(id, identityOptions(options)), shape, tableName),
    count: (where) => repository.count(where),
    create: async (data) => {
      const created = await repository.create(data);
      return mapResponse(await ensureUuid(created, repository, shape, tableName), shape, tableName);
    },
    update: async (id, data, options) =>
      mapResponse(await repository.update(id, data, identityOptions(options)), shape, tableName),
    delete: (id, options) => repository.delete(id, identityOptions(options)),
    upsert: async (data, options) => {
      const upserted = await repository.upsert(data, options);
      return mapResponse(await ensureUuid(upserted, repository, shape, tableName), shape, tableName);
    },
    transaction: repository.transaction
      ? <R>(work: (transactional: IRepository<T>) => Promise<R>) =>
          repository.transaction!(async (transactional) => work(shapeRepository(transactional, shape, tableName)))
      : undefined,
  };
}

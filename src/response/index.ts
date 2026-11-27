import { createHash } from 'node:crypto';
import type { DbIdentityOptions, DbRedactionOptions } from '../config/schema.js';
import type { DbId, IRepository, RepositoryOptions } from '../interfaces/index.js';

export interface ResponseShapeOptions {
  identity: DbIdentityOptions;
  redaction: DbRedactionOptions;
}

export function uuidv5(value: string | number, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([namespaceBytes, Buffer.from(String(value), 'utf8')]))
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

export function mapResponse<T>(row: T, shape: ResponseShapeOptions): T {
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
        : uuidv5(idSource, shape.identity.namespace);
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
): RepositoryOptions | undefined {
  if (shape.identity.strategy !== 'uuid') {
    return options;
  }
  return { ...options, idField: shape.identity.uuidColumn, idType: 'string' };
}

async function ensureUuid<T>(row: T, repository: IRepository<T>, shape: ResponseShapeOptions): Promise<void> {
  if (shape.identity.strategy !== 'uuid' || row === null || row === undefined) {
    return;
  }
  const record = row as Record<string, unknown>;
  if (typeof record[shape.identity.uuidColumn] === 'string') {
    return;
  }
  const numericId = record.id ?? record[shape.identity.numericIdProperty];
  if (numericId === undefined) {
    return;
  }
  const derived = uuidv5(numericId as string | number, shape.identity.namespace);
  await repository.update(numericId as DbId, { [shape.identity.uuidColumn]: derived } as Partial<T>, {
    idField: 'id',
  });
  record[shape.identity.uuidColumn] = derived;
}

export function shapeRepository<T>(repository: IRepository<T>, shape: ResponseShapeOptions): IRepository<T> {
  return {
    findMany: async (options) => (await repository.findMany(options)).map((row) => mapResponse(row, shape)),
    findOne: async (id, options) =>
      mapResponse(await repository.findOne(id, withIdentityOptions(options, shape)), shape),
    count: (where) => repository.count(where),
    create: async (data) => {
      const created = await repository.create(data);
      await ensureUuid(created, repository, shape);
      return mapResponse(created, shape);
    },
    update: async (id, data, options) =>
      mapResponse(await repository.update(id, data, withIdentityOptions(options, shape)), shape),
    delete: (id, options) => repository.delete(id, withIdentityOptions(options, shape)),
    upsert: async (data, options) => {
      const upserted = await repository.upsert(data, options);
      await ensureUuid(upserted, repository, shape);
      return mapResponse(upserted, shape);
    },
  };
}

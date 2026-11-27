import { describe, expect, it, vi } from 'vitest';
import { mapResponse, parseDbOptions, shapeRepository, uuidv5, type IRepository } from '../src/index.js';

const dbOptions = parseDbOptions({
  driver: 'postgres',
  identity: { strategy: 'uuid' },
  redaction: { fields: ['password', 'profile.ssn'] },
});

const shape = { identity: dbOptions.identity, redaction: dbOptions.redaction };
const TABLE = 'users';

describe('response shaping', () => {
  it('creates deterministic table-scoped UUIDs', () => {
    expect(uuidv5(7, dbOptions.identity.namespace, TABLE)).toBe(uuidv5('7', dbOptions.identity.namespace, TABLE));
    expect(uuidv5(7, dbOptions.identity.namespace, TABLE)).not.toBe(
      uuidv5(8, dbOptions.identity.namespace, TABLE),
    );
    expect(uuidv5(7, dbOptions.identity.namespace, TABLE)).not.toBe(
      uuidv5(7, dbOptions.identity.namespace, 'posts'),
    );
  });

  it('hides the numeric id and removes redacted fields', () => {
    const row = { id: 7, name: 'Ada', password: 'secret', profile: { ssn: '123', city: 'Paris' } };
    const mapped = mapResponse(row, shape, TABLE) as Record<string, unknown>;

    expect(mapped.id).toBe(uuidv5(7, dbOptions.identity.namespace, TABLE));
    expect(Object.keys(mapped)).not.toContain(dbOptions.identity.numericIdProperty);
    expect((mapped as { numericId?: number }).numericId).toBe(7);
    expect(mapped.password).toBeUndefined();
    expect((mapped.profile as Record<string, unknown>).ssn).toBeUndefined();
    expect((mapped.profile as Record<string, unknown>).city).toBe('Paris');
    expect(row.password).toBe('secret');
  });

  it('persists the UUID inside the same transaction and resolves by UUID column', async () => {
    const stored = { id: 1, name: 'Ada' } as Record<string, unknown>;
    const transaction = vi.fn(
      async <R>(work: (repository: IRepository<Record<string, unknown>>) => Promise<R>) => {
        const transactional: IRepository<Record<string, unknown>> = {
          findMany: async () => [stored],
          findOne: async () => stored,
          count: async () => 1,
          create: async (data) => ({ ...stored, ...data }),
          update: async (_id, data) => ({ ...stored, ...data }),
          delete: async () => true,
          upsert: async (data) => ({ ...stored, ...data }),
        };
        return work(transactional);
      },
    );
    const base: IRepository<Record<string, unknown>> = {
      findMany: async () => [stored],
      findOne: vi.fn(async () => stored),
      count: async () => 1,
      create: async (data) => ({ ...stored, ...data }),
      update: vi.fn(async (_id, data) => ({ ...stored, ...data })),
      delete: async () => true,
      upsert: async (data) => ({ ...stored, ...data }),
      transaction: transaction as IRepository<Record<string, unknown>>['transaction'],
    };
    const repository = shapeRepository(base, shape, TABLE);

    const created = await repository.create({ name: 'Ada' });
    expect(transaction).toHaveBeenCalledOnce();
    expect(created.id).toBe(uuidv5(1, dbOptions.identity.namespace, TABLE));

    const found = await repository.findOne(uuidv5(1, dbOptions.identity.namespace, TABLE));
    expect(base.findOne).toHaveBeenCalledWith(uuidv5(1, dbOptions.identity.namespace, TABLE), {
      idField: 'uuid',
      idType: 'string',
      uuidTable: TABLE,
    });
    expect(found?.id).toBe(uuidv5(1, dbOptions.identity.namespace, TABLE));
  });

  it('requires transactional repository support for UUID writes', async () => {
    const base: IRepository<Record<string, unknown>> = {
      findMany: async () => [],
      findOne: async () => null,
      count: async () => 0,
      create: async (data) => ({ id: 1, ...data }),
      update: async () => null,
      delete: async () => false,
      upsert: async (data) => ({ id: 1, ...data }),
    };

    await expect(shapeRepository(base, shape, TABLE).create({ name: 'Ada' })).rejects.toThrow(/transaction/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { mapResponse, parseDbOptions, shapeRepository, uuidv5, type IRepository } from '../src/index.js';

const NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const dbOptions = parseDbOptions({
  driver: 'postgres',
  identity: { strategy: 'uuid', uuidColumn: 'uuid', namespace: NAMESPACE },
  redaction: { fields: ['password', 'profile.ssn'] },
});

const shape = { identity: dbOptions.identity, redaction: dbOptions.redaction };
const TABLE = 'users';

describe('response shaping', () => {
  it('creates deterministic table-scoped UUIDs', () => {
    expect(uuidv5(7, NAMESPACE, TABLE)).toBe(uuidv5('7', NAMESPACE, TABLE));
    expect(uuidv5(7, NAMESPACE, TABLE)).not.toBe(uuidv5(8, NAMESPACE, TABLE));
    expect(uuidv5(7, NAMESPACE, TABLE)).not.toBe(uuidv5(7, NAMESPACE, 'posts'));
  });

  it('changes UUIDs when the immutable namespace changes', () => {
    const otherNamespace = '1b671a64-40d5-491e-99b0-da01ff1f3341';
    expect(uuidv5(7, otherNamespace, TABLE)).not.toBe(uuidv5(7, NAMESPACE, TABLE));
  });

  it('hides the numeric id and removes redacted fields', () => {
    const row = { id: 7, name: 'Ada', password: 'secret', profile: { ssn: '123', city: 'Paris' } };
    const mapped = mapResponse(row, shape, TABLE) as Record<string, unknown>;

    expect(mapped.id).toBe(uuidv5(7, NAMESPACE, TABLE));
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
    expect(created.id).toBe(uuidv5(1, NAMESPACE, TABLE));

    const found = await repository.findOne(uuidv5(1, NAMESPACE, TABLE));
    expect(base.findOne).toHaveBeenCalledWith(uuidv5(1, NAMESPACE, TABLE), {
      idField: 'uuid',
      idType: 'string',
      uuidTable: TABLE,
    });
    expect(found?.id).toBe(uuidv5(1, NAMESPACE, TABLE));
  });

  it('returns not-found for UUID lookup before backfill', async () => {
    const findOne = vi.fn(async () => null);
    const base: IRepository<Record<string, unknown>> = {
      findMany: async () => [],
      findOne,
      count: async () => 0,
      create: async (data) => ({ id: 1, ...data }),
      update: async () => null,
      delete: async () => false,
      upsert: async (data) => ({ id: 1, ...data }),
    };
    const repository = shapeRepository(base, shape, TABLE);
    const uuid = uuidv5(1, NAMESPACE, TABLE);

    await expect(repository.findOne(uuid)).resolves.toBeNull();
    expect(findOne).toHaveBeenCalledWith(uuid, { idField: 'uuid', idType: 'string', uuidTable: TABLE });
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

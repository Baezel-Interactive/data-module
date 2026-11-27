import { describe, expect, it, vi } from 'vitest';
import { mapResponse, parseDbOptions, shapeRepository, uuidv5, type IRepository } from '../src/index.js';

const dbOptions = parseDbOptions({
  driver: 'postgres',
  identity: { strategy: 'uuid' },
  redaction: { fields: ['password', 'profile.ssn'] },
});

const shape = { identity: dbOptions.identity, redaction: dbOptions.redaction };

describe('response shaping', () => {
  it('creates deterministic UUIDs', () => {
    expect(uuidv5(7, dbOptions.identity.namespace)).toBe(uuidv5('7', dbOptions.identity.namespace));
    expect(uuidv5(7, dbOptions.identity.namespace)).not.toBe(uuidv5(8, dbOptions.identity.namespace));
  });

  it('hides the numeric id and removes redacted fields', () => {
    const row = { id: 7, name: 'Ada', password: 'secret', profile: { ssn: '123', city: 'Paris' } };
    const mapped = mapResponse(row, shape) as Record<string, unknown>;

    expect(mapped.id).toBe(uuidv5(7, dbOptions.identity.namespace));
    expect(Object.keys(mapped)).not.toContain(dbOptions.identity.numericIdProperty);
    expect((mapped as { numericId?: number }).numericId).toBe(7);
    expect(mapped.password).toBeUndefined();
    expect((mapped.profile as Record<string, unknown>).ssn).toBeUndefined();
    expect((mapped.profile as Record<string, unknown>).city).toBe('Paris');
    expect(row.password).toBe('secret');
  });

  it('persists the UUID on create and resolves by UUID column', async () => {
    const stored = { id: 1, name: 'Ada' } as Record<string, unknown>;
    const base: IRepository<Record<string, unknown>> = {
      findMany: async () => [stored],
      findOne: vi.fn(async () => stored),
      count: async () => 1,
      create: async (data) => ({ ...stored, ...data }),
      update: vi.fn(async (_id, data) => ({ ...stored, ...data })),
      delete: async () => true,
      upsert: async (data) => ({ ...stored, ...data }),
    };
    const repository = shapeRepository(base, shape);

    const created = await repository.create({ name: 'Ada' });
    expect(base.update).toHaveBeenCalledWith(
      1,
      { uuid: uuidv5(1, dbOptions.identity.namespace) },
      { idField: 'id' },
    );
    expect(created.id).toBe(uuidv5(1, dbOptions.identity.namespace));

    const found = await repository.findOne(uuidv5(1, dbOptions.identity.namespace));
    expect(base.findOne).toHaveBeenCalledWith(uuidv5(1, dbOptions.identity.namespace), {
      idField: 'uuid',
      idType: 'string',
    });
    expect(found?.id).toBe(uuidv5(1, dbOptions.identity.namespace));
  });
});

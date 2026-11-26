import type { Document } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { DbConfigError } from '../src/index.js';
import { MongoConnector } from '../src/mongo/index.js';

const OBJECT_ID = '507f1f77bcf86cd799439011';

function createFakeClient(overrides: Record<string, unknown> = {}) {
  const collection = {
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ id: 1 }]) })),
    findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(OBJECT_ID), name: 'A' }),
    countDocuments: vi.fn().mockResolvedValue(1),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId(OBJECT_ID) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1, upsertedId: new ObjectId(OBJECT_ID) }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    ...overrides,
  };

  const session = { withTransaction: vi.fn(async (work: () => Promise<unknown>) => work()) };
  const client = {
    db: vi.fn(() => ({
      collection: vi.fn(() => collection),
      command: vi.fn().mockResolvedValue({ ok: 1 }),
    })),
    withSession: vi.fn(async (work: (value: typeof session) => Promise<unknown>) => work(session)),
    close: vi.fn(),
  } as unknown as MongoClient;

  return { client, collection, session };
}

describe('MongoConnector', () => {
  it('converts string ids to ObjectId by default', async () => {
    const { client, collection } = createFakeClient();
    const repository = MongoConnector.fromClient(client, 'app').getRepository('User');

    expect(await repository.findOne(OBJECT_ID)).toEqual({ _id: expect.any(ObjectId), name: 'A' });
    expect(collection.findOne).toHaveBeenCalledWith({ _id: expect.any(ObjectId) }, {});
  });

  it('passes non-ObjectId ids through when declared', async () => {
    const { client, collection } = createFakeClient();
    const repository = MongoConnector.fromClient(client, 'app').getRepository<{ _id: string }>('Session', {
      idType: 'string',
    });

    await repository.findOne('custom-id');

    expect(collection.findOne).toHaveBeenCalledWith({ _id: 'custom-id' }, {});
  });

  it('rejects an invalid ObjectId and requires an upsert conflict target', async () => {
    const { client, collection } = createFakeClient();
    const connector = MongoConnector.fromClient(client, 'app');
    const repository = connector.getRepository('User');

    await expect(repository.findOne('not-an-object-id')).rejects.toBeInstanceOf(DbConfigError);
    await expect(repository.upsert({ name: 'A' }, {} as never)).rejects.toBeInstanceOf(DbConfigError);

    await repository.upsert({ email: 'a@example.com' }, { conflictTarget: 'email' });
    expect(collection.updateOne).toHaveBeenCalledWith(
      { email: 'a@example.com' },
      { $set: { email: 'a@example.com' } },
      { upsert: true },
    );
  });

  it('delegates transaction retries to session.withTransaction exactly once', async () => {
    const { client, session } = createFakeClient();
    const transient = Object.assign(new Error('transient'), { errorLabels: ['TransientTransactionError'] });
    session.withTransaction.mockRejectedValueOnce(transient);
    const connector = MongoConnector.fromClient(client, 'app');

    await expect(connector.transaction(async () => 'ok')).rejects.toBe(transient);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(client.withSession).toHaveBeenCalledTimes(1);
  });

  it('reports health', async () => {
    const { client } = createFakeClient();
    const connector = MongoConnector.fromClient(client, 'app');

    expect(await connector.getHealth()).toMatchObject({ status: 'up', driver: 'mongodb' });
  });
});

export type MongoDocument = Document;

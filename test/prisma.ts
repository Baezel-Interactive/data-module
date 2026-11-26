import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { DbConfigError } from '../src/index.js';
import { PrismaConnector, type PrismaLikeClient } from '../src/prisma/index.js';

function createClient() {
  const client = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(client)),
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 1 }]),
      findUnique: vi.fn().mockResolvedValue({ id: 1 }),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockResolvedValue({ id: 1, name: 'A' }),
      update: vi.fn().mockResolvedValue({ id: 1, name: 'B' }),
      delete: vi.fn().mockResolvedValue({ id: 1 }),
      upsert: vi.fn().mockResolvedValue({ id: 1, email: 'a@example.com' }),
    },
  };
  return { client, asConnectorClient: () => client as unknown as PrismaLikeClient };
}

describe('PrismaConnector', () => {
  const { client, asConnectorClient } = createClient();

  it('uses the supplied client lifecycle and delegates', async () => {
    const connector = new PrismaConnector({ client: asConnectorClient() });
    await connector.onModuleInit();

    const repository = connector.getRepository('User');
    expect(await repository.findMany()).toEqual([{ id: 1 }]);
    expect(await repository.findOne(1)).toEqual({ id: 1 });
    expect(client.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });

    await connector.onApplicationShutdown();
    expect(client.$connect).toHaveBeenCalled();
    expect(client.$disconnect).toHaveBeenCalled();
  });

  it('performs CRUD and requires an upsert conflict target', async () => {
    const connector = new PrismaConnector({ client: asConnectorClient() });
    const repository = connector.getRepository<{ id: number; email: string }>('User');

    expect(await repository.count()).toBe(1);
    expect(await repository.create({ email: 'a@example.com' })).toEqual({ id: 1, name: 'A' });
    expect(await repository.update(1, { email: 'b@example.com' })).toEqual({ id: 1, name: 'B' });
    expect(await repository.delete(1)).toBe(true);
    expect(await repository.upsert({ email: 'a@example.com' }, { conflictTarget: 'email' })).toEqual({
      id: 1,
      email: 'a@example.com',
    });
    expect(client.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'a@example.com' } }),
    );

    await expect(repository.upsert({ email: 'a@example.com' }, {} as never)).rejects.toBeInstanceOf(DbConfigError);
  });

  it('runs health checks through the supplied client', async () => {
    const connector = new PrismaConnector({ client: asConnectorClient() });

    expect(await connector.getHealth()).toMatchObject({ status: 'up', driver: 'prisma' });
    expect(client.$queryRaw).toHaveBeenCalled();
  });
});

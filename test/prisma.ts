import 'reflect-metadata';
import { PrismaConnector } from '../src/prisma';

describe('PrismaConnector', () => {
  const client = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 1 }]),
      findUnique: jest.fn().mockResolvedValue({ id: 1 }),
    },
  };

  it('uses the supplied client lifecycle and delegates', async () => {
    const connector = new PrismaConnector({ client });
    await connector.onModuleInit();

    const repository = connector.getRepository('User');
    expect(await repository.findMany()).toEqual([{ id: 1 }]);
    expect(await repository.findOne(1)).toEqual({ id: 1 });
    expect(client.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });

    await connector.onModuleDestroy();
    expect(client.$connect).toHaveBeenCalled();
    expect(client.$disconnect).toHaveBeenCalled();
  });
});

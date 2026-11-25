import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { DbEntity, IDbConnector, IRepository } from '../interfaces';

export interface PrismaLikeClient {
  $connect(): Promise<unknown>;
  $disconnect(): Promise<unknown>;
  [key: string]: any;
}

export interface PrismaConnectorOptions {
  client: PrismaLikeClient;
}

@Injectable()
export class PrismaConnector implements IDbConnector, OnModuleInit, OnModuleDestroy {
  constructor(private readonly options: PrismaConnectorOptions) {}

  async onModuleInit(): Promise<void> {
    await this.options.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.options.client.$disconnect();
  }

  getRepository<T>(entity: DbEntity<T>): IRepository<T> {
    const name = typeof entity === 'string' ? entity : entity.name;
    const modelName = name.charAt(0).toLowerCase() + name.slice(1);
    const delegate = this.options.client[modelName];

    return {
      findMany: () => delegate.findMany() as Promise<T[]>,
      findOne: (id: number) => delegate.findUnique({ where: { id } }) as Promise<T | null>,
    };
  }
}

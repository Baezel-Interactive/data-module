import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DataSourceOptions, EntityTarget } from 'typeorm';
import type { DbEntity, IDbConnector, IRepository } from '../interfaces';

@Injectable()
export class TypeOrmConnector implements IDbConnector, OnModuleInit, OnModuleDestroy {
  private readonly dataSource: DataSource;

  constructor(options: DataSourceOptions) {
    this.dataSource = new DataSource(options);
  }

  async onModuleInit(): Promise<void> {
    if (!this.dataSource.isInitialized) {
      await this.dataSource.initialize();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  getRepository<T>(entity: DbEntity<T>): IRepository<T> {
    const repository = this.dataSource.getRepository<T>(entity as EntityTarget<T>);

    return {
      findMany: () => repository.find() as Promise<T[]>,
      findOne: (id: number) => repository.findOneBy({ id } as any) as Promise<T | null>,
    };
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }
}

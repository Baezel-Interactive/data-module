import 'reflect-metadata';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { MongoConnector } from '../../src/mongo/index.js';
import { TypeOrmConnector } from '../../src/typeorm/index.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1';

@Entity()
class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  name!: string;
}

describe.skipIf(!enabled)('SQL driver integration', () => {
  let postgres: StartedPostgreSqlContainer;
  let mysql: StartedMySqlContainer;
  let postgresConnector: TypeOrmConnector;
  let mysqlConnector: TypeOrmConnector;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    mysql = await new MySqlContainer('mysql:8').start();
    postgresConnector = new TypeOrmConnector({
      type: 'postgres',
      url: postgres.getConnectionUri(),
      entities: [User],
    });
    mysqlConnector = new TypeOrmConnector({ type: 'mysql', url: mysql.getConnectionUri(), entities: [User] });
    await Promise.all([postgresConnector.onModuleInit(), mysqlConnector.onModuleInit()]);
  });

  afterAll(async () => {
    await Promise.all([postgresConnector.onApplicationShutdown(), mysqlConnector.onApplicationShutdown()]);
    await Promise.all([postgres.stop(), mysql.stop()]);
  });

  for (const [name, connector] of [
    ['postgres', () => postgresConnector],
    ['mysql', () => mysqlConnector],
  ] as const) {
    it(`${name} supports health, CRUD and upsert`, async () => {
      const db = connector();
      expect(await db.getHealth()).toMatchObject({ status: 'up' });
      const repository = db.getRepository(User);
      const created = await repository.create({ name: `user-${Date.now()}` });
      expect(await repository.findOne(created.id)).toMatchObject({ name: created.name });
      expect(await repository.update(created.id, { name: `${created.name}-updated` })).toMatchObject({
        name: `${created.name}-updated`,
      });
      expect(await repository.count()).toBeGreaterThan(0);
      expect(await repository.delete(created.id)).toBe(true);
    });
  }
});

describe.skipIf(!enabled)('Mongo driver integration', () => {
  let container: StartedMongoDBContainer;
  let connector: MongoConnector;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    connector = new MongoConnector({ url: container.getConnectionString(), database: 'app' });
    await connector.onModuleInit();
  });

  afterAll(async () => {
    await connector.onApplicationShutdown();
    await container.stop();
  });

  it('supports non-ObjectId ids and session transactions', async () => {
    const repository = connector.getRepository<{ _id: string; name: string }>('Session', { idType: 'string' });
    await repository.create({ _id: 'integration-session', name: 'A' });
    expect(await repository.findOne('integration-session')).toMatchObject({ name: 'A' });
    expect(await connector.getHealth()).toMatchObject({ status: 'up' });
    expect(await connector.transaction(async (tx) => tx.getRepository('Session').count())).toBeGreaterThan(0);
  });
});

import type { ConnectorFactoryContext } from '../config/schema.js';
import { DbConfigError } from '../errors/index.js';
import type { IDbConnector } from '../interfaces/index.js';
import { MongoConnector } from '../mongo/connector.js';
import { PrismaConnector } from '../prisma/connector.js';
import { TypeOrmConnector } from '../typeorm/connector.js';
import { createTypeOrmDataSource } from '../typeorm/factory.js';

export function createConnectorFromDbOptions(context: ConnectorFactoryContext): IDbConnector {
  const responseShape = { identity: context.identity, redaction: context.redaction };

  if (context.orm === 'prisma') {
    if (!context.prisma?.client) {
      throw new DbConfigError('orm "prisma" requires dbOptions.prisma.client');
    }
    return new PrismaConnector({
      client: context.prisma.client,
      timeouts: context.timeouts,
      responseShape,
    });
  }

  if (context.driver === 'mongodb') {
    if (context.orm !== 'mongo') {
      throw new DbConfigError(`orm "${context.orm}" is not supported for mongodb`);
    }
    const config = context.config;
    const database = typeof config.database === 'string' ? config.database : undefined;
    const username =
      typeof config.username === 'string'
        ? config.username
        : typeof config.user === 'string'
          ? config.user
          : undefined;
    const readPreference = context.driverOptions.readPreference;
    return new MongoConnector({
      url: typeof config.url === 'string' ? config.url : undefined,
      host: typeof config.host === 'string' ? config.host : undefined,
      port: typeof config.port === 'number' ? config.port : undefined,
      database: database ?? 'app',
      username,
      password: typeof config.password === 'string' ? config.password : undefined,
      timeouts: context.timeouts,
      readPreference: typeof readPreference === 'string' ? (readPreference as never) : undefined,
      responseShape,
    });
  }

  if (context.orm !== 'typeorm') {
    throw new DbConfigError(`orm "${context.orm}" requires a supplied connector`);
  }

  const dataSource = createTypeOrmDataSource(context.dbOptions, { entities: context.resolvedEntities?.targets });
  return new TypeOrmConnector(dataSource, {
    exposeDataSource: context.safety.exposeDataSource,
    timeouts: context.timeouts,
    responseShape,
  });
}

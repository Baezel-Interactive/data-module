import type { ConnectorFactoryContext } from '../config/schema.js';
import { DbDependencyError, DbConfigError, redactString } from '../errors/index.js';
import type { IDbConnector } from '../interfaces/index.js';

type TypeOrmConnectorModule = typeof import('../typeorm/connector.js');
type MongoConnectorModule = typeof import('../mongo/connector.js');
type PrismaConnectorModule = typeof import('../prisma/connector.js');
type TypeOrmFactoryModule = typeof import('../typeorm/factory.js');

export interface ConnectorModuleLoaders {
  typeorm: () => Promise<TypeOrmConnectorModule>;
  mongo: () => Promise<MongoConnectorModule>;
  prisma: () => Promise<PrismaConnectorModule>;
  typeormFactory: () => Promise<TypeOrmFactoryModule>;
}

const defaultLoaders: ConnectorModuleLoaders = {
  typeorm: () => import('../typeorm/connector.js'),
  mongo: () => import('../mongo/connector.js'),
  prisma: () => import('../prisma/connector.js'),
  typeormFactory: () => import('../typeorm/factory.js'),
};

function installHint(context: ConnectorFactoryContext, dependency: string): string {
  if (dependency === 'prisma') {
    return 'npm install @prisma/client';
  }
  if (dependency === 'mongodb') {
    return 'npm install mongodb';
  }
  if (context.driver === 'postgres') {
    return 'npm install typeorm pg';
  }
  if (context.driver === 'mysql') {
    return 'npm install typeorm mysql2';
  }
  return `npm install ${dependency}`;
}

function dependencyFailure(
  error: unknown,
  context: ConnectorFactoryContext,
  dependency: string,
): DbDependencyError {
  return new DbDependencyError(`Missing database dependency: ${installHint(context, dependency)}`, {
    code: 'DRIVER_MISSING',
    details: {
      driver: context.driver,
      orm: context.orm,
      dependency,
      cause: redactString(String(error)),
    },
  });
}

export async function createConnectorFromDbOptions(
  context: ConnectorFactoryContext,
  loaders: ConnectorModuleLoaders = defaultLoaders,
): Promise<IDbConnector> {
  const responseShape = { identity: context.identity, redaction: context.redaction };

  if (context.orm === 'prisma') {
    if (!context.prisma?.client) {
      throw new DbConfigError('orm "prisma" requires dbOptions.prisma.client');
    }
    try {
      const { PrismaConnector } = await loaders.prisma();
      return new PrismaConnector({ client: context.prisma.client, timeouts: context.timeouts, responseShape });
    } catch (error) {
      if (error instanceof DbConfigError) {
        throw error;
      }
      throw dependencyFailure(error, context, 'prisma');
    }
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
    try {
      const { MongoConnector } = await loaders.mongo();
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
    } catch (error) {
      throw dependencyFailure(error, context, 'mongodb');
    }
  }

  if (context.orm !== 'typeorm') {
    throw new DbConfigError(`orm "${context.orm}" requires a supplied connector`);
  }

  try {
    const [{ TypeOrmConnector }, { createTypeOrmDataSource }] = await Promise.all([
      loaders.typeorm(),
      loaders.typeormFactory(),
    ]);
    const dataSource = createTypeOrmDataSource(context.dbOptions, { entities: context.resolvedEntities?.targets });
    return new TypeOrmConnector(dataSource, {
      exposeDataSource: context.safety.exposeDataSource,
      timeouts: context.timeouts,
      responseShape,
    });
  } catch (error) {
    throw dependencyFailure(error, context, 'typeorm');
  }
}

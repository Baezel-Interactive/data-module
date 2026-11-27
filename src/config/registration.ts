import { Logger } from '@nestjs/common';
import { DbConfigError } from '../errors/index.js';
import type { Hooks } from '../hooks/index.js';
import type { DbConnectorFactory, IDbConnector } from '../interfaces/index.js';
import { createConnectorFromDbOptions } from '../factories/index.js';
import { resolveEntities } from '../entities/index.js';
import { provisionDatabase } from '../provisioning/index.js';
import { assertSafetyAllowed } from '../safety/index.js';
import {
  parseDbOptions,
  resolveEnvironment,
  resolveOrm,
  type ConnectorFactoryContext,
  type DbOptions,
} from './schema.js';

export interface NormalizedRegistration {
  dbOptions: DbOptions;
  connector?: IDbConnector;
  hooks?: Hooks;
  factoryContext: ConnectorFactoryContext;
}

function isConnector(value: unknown): value is IDbConnector {
  return (
    value !== null && typeof value === 'object' && typeof (value as IDbConnector).getRepository === 'function'
  );
}

function isConnectorFactory(value: unknown): value is DbConnectorFactory {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as DbConnectorFactory).createConnector === 'function'
  );
}

export function createConnectorFactoryContext(
  dbOptions: DbOptions,
  logger: Logger = new Logger('DbModule'),
  hooks?: Hooks,
): ConnectorFactoryContext {
  return {
    dbOptions,
    driver: dbOptions.driver,
    orm: resolveOrm(dbOptions),
    config: dbOptions.config,
    safety: dbOptions.safety,
    provisioning: dbOptions.provisioning,
    entities: dbOptions.entities,
    pool: dbOptions.pool,
    timeouts: dbOptions.timeouts,
    resilience: dbOptions.resilience,
    migrations: dbOptions.migrations,
    identity: dbOptions.identity,
    redaction: dbOptions.redaction,
    driverOptions: dbOptions.driverOptions,
    prisma: dbOptions.prisma,
    resolvedEntities: undefined,
    environment: resolveEnvironment(dbOptions.environment),
    hooks: hooks ?? dbOptions.hooks,
    logger,
  };
}

export function normalizeRegistration(input: unknown): NormalizedRegistration {
  if (!input || typeof input !== 'object' || !('dbOptions' in input)) {
    throw new DbConfigError('Database registration requires dbOptions');
  }

  const candidate = input as { dbOptions: unknown; connector?: unknown; hooks?: unknown };
  const dbOptions = parseDbOptions(candidate.dbOptions);

  if (candidate.connector !== undefined && !isConnector(candidate.connector)) {
    throw new DbConfigError('connector must implement getRepository()');
  }

  const hooks = (candidate.hooks as Hooks | undefined) ?? dbOptions.hooks;
  return {
    dbOptions,
    connector: candidate.connector as IDbConnector | undefined,
    hooks,
    factoryContext: createConnectorFactoryContext(dbOptions, undefined, hooks),
  };
}

export function normalizeRegistrationValue(value: unknown): NormalizedRegistration {
  if (isConnectorFactory(value)) {
    return normalizeRegistrationValue(value.createConnector());
  }
  if (isConnector(value)) {
    throw new DbConfigError('Database registration requires dbOptions; a bare connector is not allowed');
  }
  return normalizeRegistration(value);
}

export async function resolveConnector(registration: NormalizedRegistration): Promise<IDbConnector> {
  await assertSafetyAllowed(registration.factoryContext);
  await provisionDatabase(registration.factoryContext);

  const resolvedEntities = await resolveEntities(registration.factoryContext);
  const factoryContext = resolvedEntities
    ? { ...registration.factoryContext, resolvedEntities }
    : registration.factoryContext;

  if (registration.connector) {
    return registration.connector;
  }

  const connector = await createConnectorFromDbOptions(factoryContext);
  if (!isConnector(connector)) {
    throw new DbConfigError('The configured ORM did not produce a valid connector');
  }
  return connector;
}

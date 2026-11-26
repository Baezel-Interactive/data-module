import { Logger } from '@nestjs/common';
import { DbConfigError } from '../errors/index.js';
import type { Hooks } from '../hooks/index.js';
import type { DbConnectorFactory, IDbConnector } from '../interfaces/index.js';
import { resolveEntities } from '../entities/index.js';
import { provisionDatabase } from '../provisioning/index.js';
import { assertSafetyAllowed } from '../safety/index.js';
import {
  parseDriverRegistration,
  resolveEnvironment,
  type ConnectorFactory,
  type ConnectorFactoryContext,
  type DbDriver,
  type DbEnvironment,
  type DbProvisioningOptions,
  type DbSafetyOptions,
} from './schema.js';

export interface ConnectorRegistration {
  kind?: 'connector';
  connector: IDbConnector;
  hooks?: Hooks;
}

export interface DriverRegistrationInput {
  kind: 'driver';
  driver: DbDriver;
  config: Record<string, unknown>;
  connectorFactory: ConnectorFactory;
  safety?: Partial<DbSafetyOptions>;
  provisioning?: DbProvisioningOptions;
  environment?: DbEnvironment;
  hooks?: Hooks;
}

export type DbRegistrationInput = ConnectorRegistration | DriverRegistrationInput;

export type NormalizedRegistration =
  | { kind: 'connector'; connector: IDbConnector; hooks?: Hooks }
  | { kind: 'driver'; connectorFactory: ConnectorFactory; factoryContext: ConnectorFactoryContext; hooks?: Hooks };

function isConnector(value: unknown): value is IDbConnector {
  return (
    value !== null && typeof value === 'object' && typeof (value as IDbConnector).getRepository === 'function'
  );
}

export function normalizeRegistration(input: unknown): NormalizedRegistration {
  if (!input || typeof input !== 'object') {
    throw new DbConfigError('A database registration must be an object');
  }

  if ('connector' in input) {
    const registration = input as ConnectorRegistration;
    if (!isConnector(registration.connector)) {
      throw new DbConfigError('A connector registration requires a connector with getRepository()');
    }
    return { kind: 'connector', connector: registration.connector, hooks: registration.hooks };
  }

  if ('driver' in input) {
    const parsed = parseDriverRegistration(input);
    const factoryContext: ConnectorFactoryContext = {
      driver: parsed.driver,
      config: parsed.config,
      safety: parsed.safety,
      provisioning: parsed.provisioning,
      entities: parsed.entities,
      pool: parsed.pool,
      timeouts: parsed.timeouts,
      resilience: parsed.resilience,
      driverOptions: parsed.driverOptions,
      environment: resolveEnvironment(parsed.environment),
      hooks: parsed.hooks,
      logger: new Logger('DbModule'),
    };
    return { kind: 'driver', connectorFactory: parsed.connectorFactory, factoryContext, hooks: parsed.hooks };
  }

  throw new DbConfigError('A database registration must provide either connector or driver');
}

export function isConnectorFactory(value: unknown): value is DbConnectorFactory {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as DbConnectorFactory).createConnector === 'function'
  );
}

export function normalizeRegistrationValue(value: unknown): NormalizedRegistration {
  if (isConnector(value)) {
    return normalizeRegistration({ connector: value });
  }
  if (isConnectorFactory(value)) {
    return normalizeRegistrationValue(value.createConnector());
  }
  return normalizeRegistration(value);
}

export async function resolveConnector(registration: NormalizedRegistration): Promise<IDbConnector> {
  if (registration.kind === 'connector') {
    return registration.connector;
  }

  await assertSafetyAllowed(registration.factoryContext);
  await provisionDatabase(registration.factoryContext);
  const resolvedEntities = await resolveEntities(registration.factoryContext);
  const factoryContext = resolvedEntities
    ? { ...registration.factoryContext, resolvedEntities }
    : registration.factoryContext;
  const connector = await registration.connectorFactory(factoryContext);
  if (!isConnector(connector)) {
    throw new DbConfigError('The connector factory must return a connector with getRepository()');
  }
  return connector;
}

import type { Logger } from '@nestjs/common';
import { z } from 'zod';
import { DbConfigError, redactString } from '../errors/index.js';
import type { Hooks } from '../hooks/index.js';
import type { IDbConnector } from '../interfaces/index.js';

export const dbDriverSchema = z.enum(['postgres', 'mysql', 'mongodb']);
export type DbDriver = z.infer<typeof dbDriverSchema>;

export const dbEnvironmentSchema = z.enum(['production', 'development', 'test']);
export type DbEnvironment = z.infer<typeof dbEnvironmentSchema>;

export const dbSafetySchema = z.object({
  allowSchemaSync: z.boolean().default(false),
  allowDropSchema: z.boolean().default(false),
  allowDropDatabase: z.boolean().default(false),
  allowDestructiveMigrations: z.boolean().default(false),
  allowInsecureTls: z.boolean().default(false),
  exposeDataSource: z.boolean().default(false),
  allowSeed: z.boolean().default(false),
});
export type DbSafetyOptions = z.infer<typeof dbSafetySchema>;

export const dbProvisioningSchema = z.object({
  createIfMissing: z.boolean().optional(),
  maintenanceDatabase: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
});
export type DbProvisioningOptions = z.infer<typeof dbProvisioningSchema>;

export const dbEntitiesSchema = z.object({
  glob: z.array(z.string().min(1)).default([]),
  discoverDecorators: z.boolean().default(false),
});
export type DbEntitiesOptions = z.infer<typeof dbEntitiesSchema>;

export const dbPoolSchema = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  acquireTimeoutMs: z.number().int().positive().optional(),
  idleTimeoutMs: z.number().int().positive().optional(),
  statementTimeoutMs: z.number().int().positive().optional(),
});
export type DbPoolOptions = z.infer<typeof dbPoolSchema>;

export const dbTimeoutsSchema = z.object({
  connectMs: z.number().int().positive().optional(),
  queryMs: z.number().int().positive().optional(),
  shutdownMs: z.number().int().positive().optional(),
});
export type DbTimeoutsOptions = z.infer<typeof dbTimeoutsSchema>;

export const dbResilienceSchema = z.object({
  retries: z.number().int().nonnegative().default(2),
  backoffMs: z.number().int().positive().default(50),
  breakerThreshold: z.number().int().positive().default(5),
  breakerHalfOpenMs: z.number().int().positive().default(10_000),
});
export type DbResilienceOptions = z.infer<typeof dbResilienceSchema>;

export interface ResolvedEntities {
  targets: Array<new () => unknown>;
  sources: { glob: number; decorators: number; files: number };
}

export interface ConnectorFactoryContext {
  driver: DbDriver;
  config: Record<string, unknown>;
  safety: DbSafetyOptions;
  provisioning: DbProvisioningOptions;
  entities: DbEntitiesOptions;
  pool: DbPoolOptions;
  timeouts: DbTimeoutsOptions;
  resilience: DbResilienceOptions;
  driverOptions: Record<string, unknown>;
  resolvedEntities?: ResolvedEntities;
  environment: DbEnvironment;
  hooks?: Hooks;
  logger: Logger;
}

export type ConnectorFactory = (context: ConnectorFactoryContext) => IDbConnector | Promise<IDbConnector>;

export const driverRegistrationSchema = z.object({
  kind: z.literal('driver'),
  driver: dbDriverSchema,
  config: z.record(z.string(), z.unknown()),
  connectorFactory: z.custom<ConnectorFactory>((value) => typeof value === 'function'),
  safety: dbSafetySchema.default({
    allowSchemaSync: false,
    allowDropSchema: false,
    allowDropDatabase: false,
    allowDestructiveMigrations: false,
    allowInsecureTls: false,
    exposeDataSource: false,
    allowSeed: false,
  }),
  provisioning: dbProvisioningSchema.default({}),
  entities: dbEntitiesSchema.default({ glob: [], discoverDecorators: false }),
  pool: dbPoolSchema.default({}),
  timeouts: dbTimeoutsSchema.default({}),
  resilience: dbResilienceSchema.default({
    retries: 2,
    backoffMs: 50,
    breakerThreshold: 5,
    breakerHalfOpenMs: 10_000,
  }),
  driverOptions: z.record(z.string(), z.unknown()).default({}),
  environment: dbEnvironmentSchema.optional(),
  hooks: z.custom<Hooks>((value) => typeof value === 'object' && value !== null).optional(),
});

export type DriverRegistration = z.infer<typeof driverRegistrationSchema>;

export function parseDriverRegistration(input: unknown): DriverRegistration {
  try {
    return driverRegistrationSchema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => {
        const received = 'received' in issue ? issue.received : undefined;
        return {
          path: issue.path.join('.'),
          message: redactString(issue.message),
          received: typeof received === 'string' ? redactString(received) : undefined,
        };
      });
      throw new DbConfigError('Invalid database module configuration', { details: { issues } });
    }
    throw new DbConfigError('Invalid database module configuration', {
      details: { cause: redactString(String(error)) },
    });
  }
}

export function resolveEnvironment(environment?: DbEnvironment): DbEnvironment {
  if (environment) {
    return environment;
  }
  const fromProcess = process.env.NODE_ENV;
  return fromProcess === 'production' || fromProcess === 'development' || fromProcess === 'test'
    ? fromProcess
    : 'development';
}

import type { Logger } from '@nestjs/common';
import { z } from 'zod';
import { DbConfigError, redactString } from '../errors/index.js';
import type { Hooks } from '../hooks/index.js';
import type { PrismaLikeClient } from '../prisma/connector.js';

export const dbDriverSchema = z.enum(['postgres', 'mysql', 'mongodb']);
export type DbDriver = z.infer<typeof dbDriverSchema>;

export const dbOrmSchema = z.enum(['typeorm', 'prisma', 'mongo', 'native']);
export type DbOrm = z.infer<typeof dbOrmSchema>;

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

export const dbMigrationsSchema = z.object({
  engine: z.enum(['auto', 'typeorm', 'prisma', 'mongo', 'none']).default('auto'),
  directory: z.string().min(1).default('migrations'),
  patterns: z.array(z.string().min(1)).optional(),
  tableName: z.string().min(1).default('migrations'),
  prismaSchemaPath: z.string().min(1).optional(),
  dataSourcePath: z.string().min(1).optional(),
});
export type DbMigrationsOptions = z.infer<typeof dbMigrationsSchema>;

export const dbIdentitySchema = z.object({
  strategy: z.enum(['numeric', 'uuid']).default('numeric'),
  uuidColumn: z.string().min(1).default('uuid'),
  namespace: z.string().uuid().default('6ba7b811-9dad-11d1-80b4-00c04fd430c8'),
  numericIdProperty: z.string().min(1).default('numericId'),
});
export type DbIdentityOptions = z.infer<typeof dbIdentitySchema>;

export const dbRedactionSchema = z.object({
  fields: z.array(z.string().min(1)).default([]),
});
export type DbRedactionOptions = z.infer<typeof dbRedactionSchema>;

export interface ResolvedEntities {
  targets: Array<new () => unknown>;
  sources: { glob: number; decorators: number; files: number };
}

export const dbOptionsSchema = z.object({
  driver: dbDriverSchema,
  orm: dbOrmSchema.optional(),
  config: z.record(z.string(), z.unknown()).default({}),
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
  migrations: dbMigrationsSchema.default({
    engine: 'auto',
    directory: 'migrations',
    tableName: 'migrations',
  }),
  identity: dbIdentitySchema.default({
    strategy: 'numeric',
    uuidColumn: 'uuid',
    namespace: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    numericIdProperty: 'numericId',
  }),
  redaction: dbRedactionSchema.default({ fields: [] }),
  driverOptions: z.record(z.string(), z.unknown()).default({}),
  prisma: z
    .object({
      client: z.custom<PrismaLikeClient>((value) => value !== null && typeof value === 'object'),
    })
    .optional(),
  environment: dbEnvironmentSchema.optional(),
  hooks: z.custom<Hooks>((value) => typeof value === 'object' && value !== null).optional(),
});

export type DbOptionsInput = z.input<typeof dbOptionsSchema>;
export type DbOptions = z.infer<typeof dbOptionsSchema>;

export interface ConnectorFactoryContext {
  dbOptions: DbOptions;
  driver: DbDriver;
  orm: DbOrm;
  config: Record<string, unknown>;
  safety: DbSafetyOptions;
  provisioning: DbProvisioningOptions;
  entities: DbEntitiesOptions;
  pool: DbPoolOptions;
  timeouts: DbTimeoutsOptions;
  resilience: DbResilienceOptions;
  migrations: DbMigrationsOptions;
  identity: DbIdentityOptions;
  redaction: DbRedactionOptions;
  driverOptions: Record<string, unknown>;
  prisma?: { client: PrismaLikeClient };
  resolvedEntities?: ResolvedEntities;
  environment: DbEnvironment;
  hooks?: Hooks;
  logger: Logger;
}

export function resolveOrm(dbOptions: DbOptions): DbOrm {
  if (dbOptions.orm) {
    return dbOptions.orm;
  }
  return dbOptions.driver === 'mongodb' ? 'mongo' : 'typeorm';
}

export function resolveMigrationPatterns(dbOptions: DbOptions): string[] {
  if (dbOptions.migrations.patterns && dbOptions.migrations.patterns.length > 0) {
    return dbOptions.migrations.patterns;
  }
  const directory = dbOptions.migrations.directory.replace(/\\/g, '/').replace(/\/$/, '');
  return [`${directory}/*.ts`, `${directory}/*.js`];
}

export function parseDbOptions(input: unknown): DbOptions {
  try {
    const parsed = dbOptionsSchema.parse(input);
    if (resolveOrm(parsed) === 'prisma' && !parsed.prisma?.client) {
      throw new DbConfigError('orm "prisma" requires dbOptions.prisma.client');
    }
    return parsed;
  } catch (error) {
    if (error instanceof DbConfigError) {
      throw error;
    }
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

import type { ConnectorFactoryContext } from '../config/index.js';
import { DbConfigError, DbDestructiveOperationError } from '../errors/index.js';
import type { HookEvent, Hooks } from '../hooks/index.js';

export const SAFETY_FLAGS = [
  'allowSchemaSync',
  'allowDropSchema',
  'allowDropDatabase',
  'allowDestructiveMigrations',
  'allowInsecureTls',
  'allowSeed',
] as const;

export type SafetyFlag = (typeof SAFETY_FLAGS)[number];

const OPERATION_FLAGS: Record<string, SafetyFlag> = {
  schemaSync: 'allowSchemaSync',
  dropSchema: 'allowDropSchema',
  dropDatabase: 'allowDropDatabase',
  destructiveMigration: 'allowDestructiveMigrations',
  seed: 'allowSeed',
};

function insecureTls(config: Record<string, unknown>): boolean {
  const ssl = config.ssl;
  if (ssl !== null && typeof ssl === 'object' && (ssl as Record<string, unknown>).rejectUnauthorized === false) {
    return true;
  }
  const driverOptions = config.driverOptions;
  if (driverOptions !== null && typeof driverOptions === 'object') {
    const options = driverOptions as Record<string, unknown>;
    if (options.rejectUnauthorized === false) {
      return true;
    }
    const nested = options.ssl;
    if (
      nested !== null &&
      typeof nested === 'object' &&
      (nested as Record<string, unknown>).rejectUnauthorized === false
    ) {
      return true;
    }
  }
  return false;
}

async function emit(hooks: Hooks | undefined, context: ConnectorFactoryContext, event: HookEvent): Promise<void> {
  try {
    await hooks?.onEvent?.(event);
  } catch {
    context.logger.warn('A database safety hook failed');
  }
}

export async function assertSafetyAllowed(context: ConnectorFactoryContext): Promise<void> {
  const processEnvironment = process.env.NODE_ENV;

  if (processEnvironment === 'production' && context.environment !== 'production') {
    context.logger.warn(
      `DbModule environment override to "${context.environment}" while NODE_ENV is "production"; production safety gates are still enforced.`,
    );
    await emit(context.hooks, context, {
      type: 'environment:override',
      timestamp: Date.now(),
      driver: context.driver,
      connector: 'safety',
    });
  }

  const enabled = SAFETY_FLAGS.filter((flag) => context.safety[flag]);
  if (enabled.length > 0 && context.environment === 'production') {
    throw new DbDestructiveOperationError(
      `Destructive and unsafe options are disabled in production: ${enabled.join(', ')}`,
    );
  }
  if (enabled.length > 0) {
    context.logger.warn(`Unsafe database options are enabled: ${enabled.join(', ')}`);
  }

  if (insecureTls(context.config)) {
    if (!context.safety.allowInsecureTls) {
      throw new DbConfigError('TLS verification is disabled; set safety.allowInsecureTls to override');
    }
    context.logger.warn('TLS verification is disabled by explicit configuration');
  }
}

export function assertDestructiveOperation(
  context: ConnectorFactoryContext,
  operation: keyof typeof OPERATION_FLAGS,
  options: { override?: boolean } = {},
): void {
  if (options.override) {
    context.logger.warn(`${operation} was explicitly overridden`);
    return;
  }
  const flag = OPERATION_FLAGS[operation];
  if (context.environment === 'production' || !context.safety[flag]) {
    throw new DbDestructiveOperationError(
      `${operation} is blocked; enable ${flag} outside production to allow it`,
      {
        details: { operation, flag, environment: context.environment },
      },
    );
  }
}

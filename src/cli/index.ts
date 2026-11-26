#!/usr/bin/env node
import { Logger } from '@nestjs/common';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  dbResilienceSchema,
  dbSafetySchema,
  resolveEnvironment,
  type ConnectorFactoryContext,
} from '../config/index.js';
import '../runtime/node-guard.js';
import { createMigrationStore, runMigrations, runSeeds, statusOfMigrations } from '../migrations/index.js';
import { loadCliConfig } from './config.js';

export interface CliArguments {
  command: string;
  configPath?: string;
  offline: boolean;
}

export function parseCliArguments(argv: string[]): CliArguments {
  const [command = 'status', ...flags] = argv;
  let configPath: string | undefined;
  let offline = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === '--offline') {
      offline = true;
    } else if (flag === '--config' && flags[index + 1]) {
      configPath = flags[++index];
    } else if (flag.startsWith('--config=')) {
      configPath = flag.slice('--config='.length);
    }
  }

  return { command, configPath, offline };
}

function buildContext(
  driver: ConnectorFactoryContext['driver'],
  config: Awaited<ReturnType<typeof loadCliConfig>>,
): ConnectorFactoryContext {
  return {
    driver,
    config: config.config,
    safety: dbSafetySchema.parse(config.safety),
    provisioning: {},
    entities: { glob: [], discoverDecorators: false },
    pool: {},
    timeouts: {},
    resilience: dbResilienceSchema.parse({}),
    driverOptions: {},
    environment: config.environment ?? resolveEnvironment(),
    hooks: undefined,
    logger: new Logger('baezel-data'),
  };
}

export async function runCli(argv: string[], output: (line: string) => void = console.log): Promise<void> {
  const args = parseCliArguments(argv);
  const config = await loadCliConfig(args.configPath);
  const driver = config.driver ?? 'postgres';
  const context = buildContext(driver, config);

  if (args.command === 'status') {
    const store = args.offline ? undefined : await createMigrationStore(context);
    const statuses = await statusOfMigrations(config.migrations, store);
    for (const status of statuses) {
      output(`${status.status} ${status.name}${status.changed ? ' (checksum changed)' : ''}`);
    }
    if (statuses.length === 0) {
      output('No migrations found');
    }
    return;
  }

  if (args.command === 'migrate') {
    const statuses = await runMigrations(context, config.migrations);
    for (const status of statuses) {
      output(`${status.status} ${status.name}`);
    }
    return;
  }

  if (args.command === 'seed') {
    const seeded = await runSeeds(context, config.seeds);
    for (const name of seeded) {
      output(`seeded ${name}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

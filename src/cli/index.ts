#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadModulesFromGlob } from '../entities/glob.js';
import { parseDbOptions, resolveMigrationPatterns, type DbOptionsInput } from '../config/schema.js';
import { DbConfigError } from '../errors/index.js';
import { runMigrationCommand, type MigrationCommand } from '../migration-runner/index.js';
import '../runtime/node-guard.js';

export interface CliArguments {
  command: string;
  dbConfig?: string;
  name?: string;
  offline: boolean;
}

const COMMAND_ALIASES: Record<string, MigrationCommand> = {
  make: 'make',
  'migration:create': 'make',
  create: 'make',
  up: 'up',
  'migration:run': 'up',
  run: 'up',
  down: 'down',
  'migration:revert': 'down',
  revert: 'down',
  status: 'status',
  'migration:show': 'status',
  show: 'status',
};

export function parseCliArguments(argv: string[]): CliArguments {
  const [rawCommand = 'status', ...flags] = argv;
  const command = COMMAND_ALIASES[rawCommand] ?? rawCommand;
  let dbConfig: string | undefined;
  let name: string | undefined;
  let offline = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === '--offline') {
      offline = true;
    } else if (flag === '--db-config' && flags[index + 1]) {
      dbConfig = flags[++index];
    } else if (flag.startsWith('--db-config=')) {
      dbConfig = flag.slice('--db-config='.length);
    } else if (flag === '--name' && flags[index + 1]) {
      name = flags[++index];
    } else if (flag.startsWith('--name=')) {
      name = flag.slice('--name='.length);
    }
  }

  return { command, dbConfig, name, offline };
}

export async function loadDbConfig(modulePath: string | undefined): Promise<DbOptionsInput> {
  if (!modulePath) {
    throw new DbConfigError('baezel-data requires --db-config <module-path>');
  }
  const resolved = path.resolve(process.cwd(), modulePath);
  try {
    const module = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    const candidate = module.dbOptions ?? module.default;
    if (!candidate || typeof candidate !== 'object') {
      throw new DbConfigError('The db-config module must export dbOptions');
    }
    const value = candidate as DbOptionsInput | { dbOptions?: DbOptionsInput };
    const dbOptions = ('dbOptions' in value ? value.dbOptions : value) as DbOptionsInput | undefined;
    if (!dbOptions || typeof dbOptions !== 'object' || !('driver' in dbOptions)) {
      throw new DbConfigError('The db-config module must export dbOptions');
    }
    return dbOptions;
  } catch (error) {
    if (error instanceof DbConfigError) {
      throw error;
    }
    throw new DbConfigError(`Could not load db-config module ${resolved}`, { details: { cause: String(error) } });
  }
}

export async function runCli(argv: string[], output: (line: string) => void = console.log): Promise<void> {
  const args = parseCliArguments(argv);
  if (!(args.command in COMMAND_ALIASES)) {
    throw new Error(`Unknown command: ${args.command}`);
  }
  const dbOptions = await loadDbConfig(args.dbConfig);

  if (args.offline) {
    if (args.command !== 'status') {
      throw new DbConfigError('--offline is only supported for status');
    }
    const parsed = parseDbOptions(dbOptions);
    const files = await loadModulesFromGlob(resolveMigrationPatterns(parsed), true);
    for (const file of files) {
      output(`pending ${path.basename(file.file)}`);
    }
    if (files.length === 0) {
      output('No migrations found');
    }
    return;
  }

  const lines = await runMigrationCommand(dbOptions, args.command as MigrationCommand, { name: args.name });
  for (const line of lines) {
    output(line);
  }
}

const argvEntry = process.argv[1];
const entry = argvEntry && existsSync(argvEntry) ? realpathSync(argvEntry) : '';
if (entry && fileURLToPath(import.meta.url) === entry) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createConnectorFactoryContext } from '../config/registration.js';
import { parseDbOptions, resolveOrm, type DbOptionsInput } from '../config/schema.js';
import { DbCliDependencyError, DbConfigError, DbDestructiveOperationError } from '../errors/index.js';
import { assertDestructiveOperation } from '../safety/policy.js';

export type MigrationCommand = 'make' | 'up' | 'down' | 'status';

export interface MigrationCommandOptions {
  name?: string;
  cwd?: string;
  executor?: MigrationCommandExecutor;
  cliResolver?: (packageName: string, binary: string) => string;
}

export type MigrationCommandExecutor = (
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd: string,
) => Promise<void>;

const requireFromHere = createRequire(import.meta.url);

export const defaultMigrationCommandExecutor: MigrationCommandExecutor = async (command, args, env, cwd) => {
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
};

function defaultCliResolver(packageName: string, binary: string): string {
  if (packageName === 'prisma') {
    const packageJson = requireFromHere.resolve('prisma/package.json');
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as { bin?: string | Record<string, string> };
    const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.prisma;
    if (!entry) {
      throw new Error('prisma package has no bin entry');
    }
    return path.resolve(path.dirname(packageJson), entry);
  }
  return requireFromHere.resolve(`${packageName}/${binary}`);
}

function commandPath(
  packageName: string,
  binary: string,
  resolver: (packageName: string, binary: string) => string,
): string {
  try {
    return resolver(packageName, binary);
  } catch {
    throw new DbCliDependencyError(`${packageName} is required for this migration command`, {
      details: { package: packageName },
    });
  }
}

function connectionUrl(dbOptions: ReturnType<typeof parseDbOptions>): string {
  const config = dbOptions.config;
  const url = typeof config.url === 'string' ? config.url : undefined;
  if (url) {
    return url;
  }
  const host = typeof config.host === 'string' ? config.host : 'localhost';
  const port = typeof config.port === 'number' ? config.port : dbOptions.driver === 'postgres' ? 5432 : 3306;
  const database = typeof config.database === 'string' ? config.database : 'app';
  const username =
    typeof config.username === 'string' ? config.username : typeof config.user === 'string' ? config.user : '';
  const password = typeof config.password === 'string' ? config.password : '';
  const credentials =
    username || password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
  const protocol = dbOptions.driver === 'postgres' ? 'postgres' : 'mysql';
  return `${protocol}://${credentials}${host}:${port}/${database}`;
}

async function withTypeOrmDataSource<T>(
  dbOptions: ReturnType<typeof parseDbOptions>,
  work: (dataSourcePath: string, env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const root = path.resolve(process.cwd());
  const directory = mkdtempSync(path.join(root, '.baezel-data-'));
  chmodSync(directory, 0o700);
  const dataSourcePath = path.join(directory, 'data-source.mjs');
  writeFileSync(
    dataSourcePath,
    "import { createTypeOrmDataSource } from '@baezel/data-module/typeorm';\n" +
      'export default createTypeOrmDataSource(JSON.parse(process.env.BAEZEL_DB_OPTIONS_JSON));\n',
    { mode: 0o600 },
  );
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  const onInterrupt = () => cleanup();
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);

  try {
    return await work(dataSourcePath, { BAEZEL_DB_OPTIONS_JSON: JSON.stringify(dbOptions) });
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onInterrupt);
    cleanup();
  }
}

function unsupported(orm: string, command: MigrationCommand): never {
  throw new DbConfigError(`${command} is not supported for orm "${orm}"`, { details: { orm, command } });
}

export async function runMigrationCommand(
  input: DbOptionsInput,
  command: MigrationCommand,
  options: MigrationCommandOptions = {},
): Promise<string[]> {
  const dbOptions = parseDbOptions(input);
  const orm = resolveOrm(dbOptions);
  const engine = dbOptions.migrations.engine === 'auto' ? orm : dbOptions.migrations.engine;
  const executor = options.executor ?? defaultMigrationCommandExecutor;
  const resolveCli = options.cliResolver ?? defaultCliResolver;
  const cwd = options.cwd ?? process.cwd();
  const lines: string[] = [];

  if (engine === 'mongo' || engine === 'none') {
    unsupported(orm, command);
  }

  if (engine === 'typeorm') {
    const cli =
      command === 'make'
        ? commandPath('typeorm', 'cli.js', resolveCli)
        : commandPath('typeorm', 'cli-ts-node-esm.js', resolveCli);
    const directory = dbOptions.migrations.directory;

    if (command === 'make') {
      if (!options.name) {
        throw new DbConfigError('make requires a migration name');
      }
      const args = ['migration:create', path.posix.join(directory.replace(/\\/g, '/'), options.name)];
      await executor(process.execPath, [cli, ...args], {}, cwd);
      lines.push(`typeorm ${args.join(' ')}`);
      return lines;
    }

    const context = createConnectorFactoryContext(dbOptions);
    if (command === 'down') {
      assertDestructiveOperation(context, 'destructiveMigration');
    }

    await withTypeOrmDataSource(dbOptions, async (dataSourcePath, env) => {
      const action =
        command === 'up' ? 'migration:run' : command === 'down' ? 'migration:revert' : 'migration:show';
      const args = [action, '-d', dataSourcePath];
      await executor(process.execPath, [cli, ...args], env, cwd);
      lines.push(`typeorm ${action} -d <generated-data-source>`);
    });
    return lines;
  }

  if (engine === 'prisma') {
    if (command === 'make' || command === 'down') {
      unsupported(orm, command);
    }
    const cli = commandPath('prisma', 'dist/prisma.js', resolveCli);
    const schema = dbOptions.migrations.prismaSchemaPath ?? 'prisma/schema.prisma';
    const args =
      command === 'up' ? ['migrate', 'deploy', '--schema', schema] : ['migrate', 'status', '--schema', schema];
    await executor(process.execPath, [cli, ...args], { DATABASE_URL: connectionUrl(dbOptions) }, cwd);
    lines.push(`prisma ${args.join(' ')}`);
    return lines;
  }

  throw new DbDestructiveOperationError(`Unsupported migration engine: ${engine}`);
}

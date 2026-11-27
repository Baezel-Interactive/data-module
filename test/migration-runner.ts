import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DbConfigError,
  DbDependencyError,
  DbDestructiveOperationError,
  runMigrationCommand,
} from '../src/index.js';

const base = {
  driver: 'postgres' as const,
  config: { host: 'localhost', database: 'app' },
  provisioning: { createIfMissing: false },
};

function executor() {
  return vi.fn(async (_command: string, _args: string[], _env: Record<string, string>) => undefined);
}

describe('ORM-aware migration commands', () => {
  it('maps make to a TypeORM empty migration skeleton', async () => {
    const run = executor();
    const lines = await runMigrationCommand(base, 'make', { name: 'AddUsers', executor: run });

    expect(lines[0]).toContain('migration:create migrations/AddUsers');
    const args = (run.mock.calls[0][1] as string[]).slice(1);
    expect(args).toEqual(['migration:create', 'migrations/AddUsers']);
  });

  it('maps up and status to TypeORM commands with a generated data source', async () => {
    const run = executor();
    await runMigrationCommand(base, 'up', { executor: run });
    const [command, args, env] = run.mock.calls[0] as [string, string[], Record<string, string>];

    expect(args[1]).toBe('migration:run');
    expect(args[3]).toContain('data-source.mjs');
    expect(env.BAEZEL_DB_OPTIONS_JSON).toContain('app');
    expect(existsSync(args[3])).toBe(false);
    expect(readdirSync(process.cwd()).some((name) => name.startsWith('.baezel-data-'))).toBe(false);
    expect(command).toBe(process.execPath);
  });

  it('gates down behind destructive-operation approval', async () => {
    const run = executor();
    await expect(runMigrationCommand(base, 'down', { executor: run })).rejects.toBeInstanceOf(
      DbDestructiveOperationError,
    );
    expect(run).not.toHaveBeenCalled();

    await runMigrationCommand({ ...base, safety: { allowDestructiveMigrations: true } }, 'down', {
      executor: run,
    });
    expect((run.mock.calls[0][1] as string[])[1]).toBe('migration:revert');
  });

  it('maps Prisma up/status and rejects Prisma make/down', async () => {
    const prismaDbOptions = {
      driver: 'postgres' as const,
      orm: 'prisma' as const,
      config: { host: 'localhost', database: 'app' },
      prisma: { client: { $connect: async () => undefined, $disconnect: async () => undefined } },
    };
    const run = executor();

    await runMigrationCommand(prismaDbOptions, 'status', { executor: run });
    expect((run.mock.calls[0][1] as string[]).slice(1)).toEqual([
      'migrate',
      'status',
      '--schema',
      'prisma/schema.prisma',
    ]);
    expect((run.mock.calls[0][2] as Record<string, string>).DATABASE_URL).toContain('app');

    await expect(
      runMigrationCommand(prismaDbOptions, 'make', { name: 'X', executor: run }),
    ).rejects.toBeInstanceOf(DbConfigError);
    await expect(
      runMigrationCommand({ ...prismaDbOptions, safety: { allowDestructiveMigrations: true } }, 'down', {
        executor: run,
      }),
    ).rejects.toBeInstanceOf(DbConfigError);
  });

  it('reports Mongo migrations as unsupported', async () => {
    const run = executor();
    await expect(
      runMigrationCommand({ driver: 'mongodb', config: { url: 'mongodb://localhost/app' } }, 'up', {
        executor: run,
      }),
    ).rejects.toBeInstanceOf(DbConfigError);
    expect(run).not.toHaveBeenCalled();
  });

  it('throws a typed error when an ORM CLI is missing', async () => {
    const prismaDbOptions = {
      driver: 'postgres' as const,
      orm: 'prisma' as const,
      config: {},
      prisma: { client: { $connect: async () => undefined, $disconnect: async () => undefined } },
    };
    const cliResolver = () => {
      throw new Error('not installed');
    };

    const promise = runMigrationCommand(prismaDbOptions, 'status', { executor: executor(), cliResolver });
    await expect(promise).rejects.toBeInstanceOf(DbDependencyError);
    await expect(promise).rejects.toMatchObject({ code: 'CLI_DEPENDENCY_MISSING' });
  });

  it('cleans up the generated wrapper when the executor fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('executor failed');
    });

    await expect(runMigrationCommand(base, 'up', { executor: failing })).rejects.toThrow('executor failed');
    expect(readdirSync(process.cwd()).some((name) => name.startsWith('.baezel-data-'))).toBe(false);
  });

  it('creates a TypeORM skeleton with timestamped filename and class from a different cwd', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'baezel-make-'));
    try {
      await runMigrationCommand({ ...base, migrations: { directory: 'migrations' } }, 'make', {
        name: 'AddUsers',
        cwd,
      });

      const files = readdirSync(path.join(cwd, 'migrations'));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{13}-AddUsers\.ts$/);

      const source = readFileSync(path.join(cwd, 'migrations', files[0]), 'utf8');
      expect(source).toMatch(/export class AddUsers\d{13} implements MigrationInterface/);
      expect(source).toContain('async up(');
      expect(source).toContain('async down(');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

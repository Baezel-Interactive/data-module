import { describe, expect, it, vi } from 'vitest';
import { discoverMigrations, statusOfMigrations } from '../src/index.js';
import { runCli } from '../src/cli/index.js';
import { OpenTelemetryHooks } from '../src/otel/index.js';

const PATTERN = 'test/fixtures/migrations/*.js';

describe('migrations', () => {
  it('discovers migration files in order with checksums', async () => {
    const migrations = await discoverMigrations([PATTERN]);

    expect(migrations.map((migration) => migration.name)).toEqual(['001_init.js', '002_indexes.js']);
    expect(migrations[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reports pending status without a database', async () => {
    const statuses = await statusOfMigrations([PATTERN]);

    expect(statuses).toHaveLength(2);
    expect(statuses.every((status) => status.status === 'pending' && !status.changed)).toBe(true);
  });

  it('runs the CLI status command from a config file', async () => {
    const output: string[] = [];
    await runCli(['status', '--offline', '--config', 'test/fixtures/cli.config.js'], (line) => output.push(line));

    expect(output).toContain('pending 001_init.js');
    expect(output).toContain('pending 002_indexes.js');
  });
});

describe('OpenTelemetry hooks', () => {
  it('emits spans without requiring a configured provider', () => {
    const hooks = new OpenTelemetryHooks({ tracerName: 'test' });
    const onEvent = vi.spyOn(hooks, 'onEvent');
    const onError = vi.spyOn(hooks, 'onError');

    hooks.onEvent({ type: 'connection:opened', timestamp: Date.now(), driver: 'postgres' });
    hooks.onError({
      type: 'error',
      timestamp: Date.now(),
      driver: 'postgres',
      kind: 'connection',
      code: 'CONNECTION_FAILED',
      message: 'redacted message',
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });
});

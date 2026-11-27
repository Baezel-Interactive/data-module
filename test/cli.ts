import { describe, expect, it } from 'vitest';
import { DbConfigError } from '../src/index.js';
import {
  installCliSignalHandlers,
  loadDbConfig,
  parseCliArguments,
  type CliSignalHandlers,
} from '../src/cli/index.js';

describe('baezel-data CLI', () => {
  it('normalizes TypeORM-style command aliases', () => {
    expect(parseCliArguments(['migration:create', 'AddUsers']).command).toBe('make');
    expect(parseCliArguments(['migration:run']).command).toBe('up');
    expect(parseCliArguments(['migration:revert']).command).toBe('down');
    expect(parseCliArguments(['migration:show']).command).toBe('status');
  });

  it('loads dbOptions from a user module', async () => {
    const dbOptions = await loadDbConfig('test/fixtures/db-config.js');
    expect(dbOptions.driver).toBe('postgres');
  });

  it('requires --db-config', async () => {
    await expect(loadDbConfig(undefined)).rejects.toBeInstanceOf(DbConfigError);
  });

  it('cleans up and re-raises SIGINT and SIGTERM', () => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const events: string[] = [];
      const listeners = new Map<NodeJS.Signals, () => void>();
      const handlers: CliSignalHandlers = {
        on: (name, listener) => {
          listeners.set(name, listener);
          events.push(`on:${name}`);
        },
        off: (name) => {
          listeners.delete(name);
          events.push(`off:${name}`);
        },
        kill: (_pid, name) => {
          events.push(`kill:${name}`);
        },
      };
      const controller = new AbortController();
      installCliSignalHandlers(controller, handlers);

      listeners.get(signal)?.();

      expect(controller.signal.aborted).toBe(true);
      expect(events).toContain(`off:${signal}`);
      expect(events).toContain(`kill:${signal}`);
      expect(events.indexOf(`off:${signal}`)).toBeLessThan(events.indexOf(`kill:${signal}`));
    }
  });
});

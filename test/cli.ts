import { describe, expect, it } from 'vitest';
import { DbConfigError } from '../src/index.js';
import { loadDbConfig, parseCliArguments } from '../src/cli/index.js';

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
});

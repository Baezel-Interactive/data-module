import { describe, expect, it, vi } from 'vitest';
import {
  closeWithTimeout,
  dbResilience,
  isTransientDatabaseError,
  mapPoolOptions,
  type DbResilienceOptions,
} from '../src/index.js';

const options: DbResilienceOptions = {
  retries: 2,
  backoffMs: 1,
  breakerThreshold: 10,
  breakerHalfOpenMs: 1_000,
};

describe('pool mapping', () => {
  it('maps common settings per driver without a Mongo queueLimit', () => {
    expect(
      mapPoolOptions('postgres', { min: 1, max: 5, statementTimeoutMs: 100 }, { connectMs: 500 }),
    ).toMatchObject({ min: 1, max: 5, connectionTimeoutMillis: 500, query_timeout: 100 });
    expect(mapPoolOptions('mysql', { max: 4 }, {})).toMatchObject({ connectionLimit: 4 });
    const mongo = mapPoolOptions('mongodb', { max: 6 }, { queryMs: 200 });
    expect(mongo).toMatchObject({ maxPoolSize: 6, socketTimeoutMS: 200 });
    expect(mongo).not.toHaveProperty('queueLimit');
  });
});

describe('bounded shutdown', () => {
  it('forces close when the graceful deadline expires', async () => {
    const force = vi.fn();
    await expect(closeWithTimeout(() => new Promise(() => undefined), 20, force)).rejects.toMatchObject({
      code: 'SHUTDOWN_TIMEOUT',
    });
    expect(force).toHaveBeenCalledOnce();
  });
});

describe('resilience', () => {
  it('classifies transient database errors', () => {
    expect(isTransientDatabaseError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isTransientDatabaseError(new Error('validation'))).toBe(false);
  });

  it('retries idempotent operations and not non-idempotent ones', async () => {
    const retryable = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
      .mockResolvedValue('done');
    await expect(
      dbResilience.execute(`retry-${Date.now()}`, options, retryable, { idempotent: true }),
    ).resolves.toBe('done');
    expect(retryable).toHaveBeenCalledTimes(2);

    const write = vi.fn().mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
    await expect(dbResilience.execute(`write-${Date.now()}`, options, write)).rejects.toThrow();
    expect(write).toHaveBeenCalledOnce();
  });
});

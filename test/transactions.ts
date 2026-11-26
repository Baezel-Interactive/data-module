import { describe, expect, it, vi } from 'vitest';
import { DbConnectionError, withTransactionRetry } from '../src/index.js';

describe('transaction retry', () => {
  it('retries the whole callback on transient errors', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('serialization'), { code: '40001' }))
      .mockResolvedValue('done');

    await expect(withTransactionRetry(operation, { retries: 2, timeoutMs: 1000 })).resolves.toBe('done');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient errors', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('validation failed'));

    await expect(withTransactionRetry(operation)).rejects.toThrow('validation failed');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('caps attempts when retries are exhausted', async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error('deadlock'), { code: '40P01' }));

    await expect(withTransactionRetry(operation, { retries: 1, timeoutMs: 1000 })).rejects.toBeInstanceOf(
      DbConnectionError,
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

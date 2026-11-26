import { DbConnectionError, normalizeDbError } from '../errors/index.js';
import type { TransactionOptions } from '../interfaces/index.js';

const TRANSIENT_CODES = new Set([
  'TRANSIENT_TRANSACTION_ERROR',
  'SERIALIZATION_FAILURE',
  'DEADLOCK_DETECTED',
  'CONNECTION_FAILED',
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DbConnectionError('Transaction timed out', { code: 'TRANSACTION_TIMEOUT' })),
      ms,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

export async function withTransactionRetry<T>(
  operation: () => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  let attempt = 0;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new DbConnectionError('Transaction timed out', { code: 'TRANSACTION_TIMEOUT' });
    }

    try {
      return await withTimeout(operation(), remaining);
    } catch (error) {
      const normalized = normalizeDbError(error, 'transaction');
      if (!TRANSIENT_CODES.has(normalized.code) || attempt >= retries || Date.now() >= deadline) {
        throw normalized;
      }
      const wait = Math.min(50 * 2 ** attempt, Math.max(0, deadline - Date.now()));
      attempt += 1;
      if (wait > 0) {
        await delay(wait);
      }
    }
  }
}

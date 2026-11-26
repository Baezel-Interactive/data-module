import { circuitBreaker, ConsecutiveBreaker, ExponentialBackoff, handleAll, handleWhen, retry } from 'cockatiel';
import type { DbResilienceOptions } from '../config/index.js';
import { normalizeDbError } from '../errors/index.js';

const TRANSIENT_CODES = new Set([
  'TRANSIENT_TRANSACTION_ERROR',
  'SERIALIZATION_FAILURE',
  'DEADLOCK_DETECTED',
  'CONNECTION_FAILED',
  'CONNECTION_TIMEOUT',
]);

export function isTransientDatabaseError(error: unknown): boolean {
  return TRANSIENT_CODES.has(normalizeDbError(error, 'resilience').code);
}

export interface ResilienceExecutionOptions {
  idempotent?: boolean;
}

export class DbResilienceRegistry {
  private readonly breakers = new Map<string, ReturnType<typeof circuitBreaker>>();

  private breakerFor(name: string, options: DbResilienceOptions): ReturnType<typeof circuitBreaker> {
    const existing = this.breakers.get(name);
    if (existing) {
      return existing;
    }
    const breaker = circuitBreaker(handleAll, {
      halfOpenAfter: options.breakerHalfOpenMs,
      breaker: new ConsecutiveBreaker(options.breakerThreshold),
    });
    this.breakers.set(name, breaker);
    return breaker;
  }

  execute<T>(
    name: string,
    options: DbResilienceOptions,
    operation: () => Promise<T>,
    execution: ResilienceExecutionOptions = {},
  ): Promise<T> {
    const breaker = this.breakerFor(name, options);
    if (!execution.idempotent) {
      return breaker.execute(operation);
    }

    const retryPolicy = retry(handleWhen(isTransientDatabaseError), {
      maxAttempts: options.retries + 1,
      backoff: new ExponentialBackoff({
        initialDelay: options.backoffMs,
        maxDelay: options.backoffMs * 10,
      }),
    });
    return breaker.execute(() => retryPolicy.execute(operation));
  }
}

export const dbResilience = new DbResilienceRegistry();

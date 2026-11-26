import { DbConnectionError } from '../errors/index.js';

export async function closeWithTimeout(
  close: () => Promise<unknown>,
  timeoutMs: number,
  force: () => void | Promise<void>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void Promise.resolve(force()).catch(() => undefined);
      reject(new DbConnectionError('Database shutdown timed out', { code: 'SHUTDOWN_TIMEOUT' }));
    }, timeoutMs);
  });

  try {
    await Promise.race([Promise.resolve(close()), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

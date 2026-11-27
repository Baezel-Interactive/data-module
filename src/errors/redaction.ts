const SECRET_KEY =
  /^(password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth|dsn|connectionstring|url)$/i;
const URI_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)([^:/@\s]+):([^@\s]+)@/gi;
const URI_SECRET_PARAM =
  /([?&])(password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth)=([^&\s]+)/gi;
const KEY_VALUE_SECRET =
  /(password|passwd|pwd|secret|token|api[-_]?key|authorization|auth)\s*[:=]\s*['"]?[^'"\s,;}]+/gi;
const BARE_SECRET = /(password|passwd|pwd|secret|token)\s+([A-Za-z0-9_\-./+=:@]{3,})/gi;

export function redactString(value: string): string {
  return value
    .replace(URI_CREDENTIALS, '$1$2:[REDACTED]@')
    .replace(URI_SECRET_PARAM, '$1$2=[REDACTED]')
    .replace(KEY_VALUE_SECRET, '$1=[REDACTED]')
    .replace(BARE_SECRET, '$1 [REDACTED]');
}

export function redactUnknown(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (value instanceof Error) {
    const withCause = value as Error & { cause?: unknown };
    return {
      name: value.name,
      message: redactString(value.message),
      stack: typeof value.stack === 'string' ? redactString(value.stack) : undefined,
      cause: withCause.cause === undefined ? undefined : redactUnknown(withCause.cause, seen),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redactUnknown(item, seen);
  }
  return result;
}

export function redactParameters(parameters: readonly unknown[]): unknown[] {
  return parameters.map(() => '[REDACTED]');
}

export function redactedJson(value: unknown): string {
  return JSON.stringify(redactUnknown(value));
}

import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  createErrorHookEvent,
  DbConfigError,
  DbConnectionError,
  DbProvisioningError,
  normalizeDbError,
  redactedJson,
  redactParameters,
  redactString,
} from '../src/index.js';

describe('database error taxonomy', () => {
  it('maps SQLSTATE codes, driver errnos and Mongo error labels', () => {
    expect(normalizeDbError(Object.assign(new Error('deadlock'), { code: '40P01' }))).toBeInstanceOf(
      DbConnectionError,
    );
    expect(normalizeDbError(Object.assign(new Error('deadlock'), { code: '1213' })).code).toBe(
      'SERIALIZATION_FAILURE',
    );
    expect(
      normalizeDbError(Object.assign(new Error('transient'), { errorLabels: ['TransientTransactionError'] })).code,
    ).toBe('TRANSIENT_TRANSACTION_ERROR');
    expect(normalizeDbError(Object.assign(new Error('exists'), { code: '42P04' }), 'provisioning')).toBeInstanceOf(
      DbProvisioningError,
    );
    expect(normalizeDbError(new DbConfigError('bad config'))).toBeInstanceOf(DbConfigError);
  });

  it('redacts credentials from messages, stacks, JSON and util.inspect', () => {
    const secret = 'super-secret';
    const error = new Error(`connect postgres://user:${secret}@db:5432/app?token=${secret}`);
    const normalized = normalizeDbError(error, 'connection');

    expect(normalized.message).not.toContain(secret);
    expect(normalized.stack).not.toContain(secret);
    expect(JSON.stringify(normalized)).not.toContain(secret);
    expect(inspect(normalized)).not.toContain(secret);
    expect(redactString(`password=${secret}`)).not.toContain(secret);
    expect(redactedJson({ password: secret, nested: { url: `mongodb://u:${secret}@host` } })).not.toContain(
      secret,
    );

    expect(error.message).toContain(secret);
  });

  it('redacts hook payloads and bound parameters', () => {
    const secret = 'hook-secret';
    const event = createErrorHookEvent(new Error(`mongodb://user:${secret}@host/db`), 'connection');

    expect(event.message).not.toContain(secret);
    expect(JSON.stringify(event)).not.toContain(secret);
    expect(redactParameters([secret, 42])).toEqual(['[REDACTED]', '[REDACTED]']);
  });
});

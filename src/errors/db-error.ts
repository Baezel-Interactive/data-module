import { inspect } from 'node:util';
import { redactString, redactUnknown } from './redaction.js';

export type DbErrorKind = 'config' | 'provisioning' | 'connection' | 'destructive' | 'unknown';

export interface DbErrorOptions {
  code?: string;
  details?: Record<string, unknown>;
}

export abstract class DbError extends Error {
  abstract readonly kind: DbErrorKind;
  readonly code: string;
  readonly details: Record<string, unknown>;

  protected constructor(kind: DbErrorKind, code: string, message: string, options: DbErrorOptions = {}) {
    super(redactString(message));
    this.name = `Db${kind.charAt(0).toUpperCase()}${kind.slice(1)}Error`;
    this.code = code;
    this.details = redactUnknown(options.details ?? {}) as Record<string, unknown>;
    if (this.stack) {
      this.stack = redactString(this.stack);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }

  [inspect.custom](): Record<string, unknown> {
    return this.toJSON();
  }
}

export class DbConfigError extends DbError {
  readonly kind = 'config' as const;

  constructor(message: string, options: DbErrorOptions = {}) {
    super('config', options.code ?? 'CONFIG_INVALID', message, options);
    this.name = 'DbConfigError';
  }
}

export class DbProvisioningError extends DbError {
  readonly kind = 'provisioning' as const;

  constructor(message: string, options: DbErrorOptions = {}) {
    super('provisioning', options.code ?? 'PROVISIONING_FAILED', message, options);
    this.name = 'DbProvisioningError';
  }
}

export class DbConnectionError extends DbError {
  readonly kind = 'connection' as const;

  constructor(message: string, options: DbErrorOptions = {}) {
    super('connection', options.code ?? 'CONNECTION_FAILED', message, options);
    this.name = 'DbConnectionError';
  }
}

export class DbDestructiveOperationError extends DbError {
  readonly kind = 'destructive' as const;

  constructor(message: string, options: DbErrorOptions = {}) {
    super('destructive', options.code ?? 'DESTRUCTIVE_OPERATION_BLOCKED', message, options);
    this.name = 'DbDestructiveOperationError';
  }
}

export class DbDependencyError extends DbError {
  readonly kind = 'unknown' as const;

  constructor(message: string, options: DbErrorOptions = {}) {
    super('unknown', options.code ?? 'DEPENDENCY_MISSING', message, options);
    this.name = 'DbDependencyError';
  }
}

export class DbUnknownError extends DbError {
  readonly kind = 'unknown' as const;

  constructor(message: string, options: DbErrorOptions = {}) {
    super('unknown', options.code ?? 'UNKNOWN', message, options);
    this.name = 'DbUnknownError';
  }
}

function asRecord(error: unknown): Record<string, unknown> {
  return error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : {};
}

export function normalizeDbError(error: unknown, context?: string): DbError {
  if (error instanceof DbError) {
    return error;
  }

  const record = asRecord(error);
  const code =
    typeof record.code === 'string' ? record.code : typeof record.errno === 'number' ? String(record.errno) : '';
  const sqlState = typeof record.sqlState === 'string' ? record.sqlState : '';
  const labels = Array.isArray(record.errorLabels) ? record.errorLabels.map(String) : [];
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const details: Record<string, unknown> = {
    context,
    originalName: name,
    code,
    sqlState,
    labels,
    cause: redactString(message),
  };

  if (code === 'P2034' || labels.includes('TransientTransactionError')) {
    return new DbConnectionError('A transient database operation failed', {
      code: 'TRANSIENT_TRANSACTION_ERROR',
      details,
    });
  }
  if (code === '40001' || sqlState === '40001' || code === '1213') {
    return new DbConnectionError('A transaction was serialized or deadlocked; retry it', {
      code: 'SERIALIZATION_FAILURE',
      details,
    });
  }
  if (code === '40P01' || code === '1205') {
    return new DbConnectionError('A database deadlock was detected', { code: 'DEADLOCK_DETECTED', details });
  }
  if (code === '42P04' || (code === '23505' && context === 'provisioning')) {
    return new DbProvisioningError('The database already exists', { code: 'DATABASE_EXISTS', details });
  }
  if (code === '1049' || code === '3D000' || code === 'ER_BAD_DB_ERROR') {
    return new DbProvisioningError('The database does not exist', { code: 'DATABASE_NOT_FOUND', details });
  }
  if (code === '28P01' || code === 'ER_ACCESS_DENIED_ERROR' || (name === 'MongoServerError' && code === '18')) {
    return new DbConnectionError('Database authentication failed', { code: 'AUTHENTICATION_FAILED', details });
  }
  if (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|MongoNetworkError|MongoServerSelectionError/.test(
      `${code} ${name}`,
    )
  ) {
    return new DbConnectionError('Could not connect to the database', { code: 'CONNECTION_FAILED', details });
  }

  return new DbUnknownError(message || 'An unknown database error occurred', { details });
}

import { normalizeDbError, type DbErrorKind } from '../errors/index.js';

export type HookEventType =
  | 'connector:created'
  | 'provisioning:start'
  | 'provisioning:complete'
  | 'connection:opened'
  | 'connection:closed'
  | 'migration:start'
  | 'migration:complete'
  | 'destructive:blocked'
  | 'environment:override'
  | 'error'
  | 'shutdown';

export interface HookEvent {
  type: HookEventType;
  timestamp: number;
  driver?: string;
  connector?: string;
  durationMs?: number;
}

export interface HookErrorEvent extends HookEvent {
  type: 'error';
  kind: DbErrorKind;
  code: string;
  message: string;
}

/** @experimental The hook surface is unstable through the 1.0 betas and is frozen at RC. Payloads never include bound parameters. */
export interface Hooks {
  onEvent?(event: HookEvent): void | Promise<void>;
  onError?(event: HookErrorEvent): void | Promise<void>;
}

export function createErrorHookEvent(error: unknown, context?: string): HookErrorEvent {
  const normalized = normalizeDbError(error, context);
  return {
    type: 'error',
    timestamp: Date.now(),
    kind: normalized.kind,
    code: normalized.code,
    message: normalized.message,
  };
}

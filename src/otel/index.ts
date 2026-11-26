import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { HookErrorEvent, HookEvent, Hooks } from '../hooks/index.js';
import '../runtime/node-guard.js';

export interface OpenTelemetryHooksOptions {
  tracerName?: string;
}

export class OpenTelemetryHooks implements Hooks {
  private readonly tracer: ReturnType<typeof trace.getTracer>;

  constructor(options: OpenTelemetryHooksOptions = {}) {
    this.tracer = trace.getTracer(options.tracerName ?? '@baezel/data-module');
  }

  onEvent(event: HookEvent): void {
    const span = this.tracer.startSpan(`db.${event.type}`);
    if (event.driver) {
      span.setAttribute('db.system.name', event.driver);
    }
    if (event.connector) {
      span.setAttribute('db.connector', event.connector);
    }
    if (event.durationMs !== undefined) {
      span.setAttribute('db.duration_ms', event.durationMs);
    }
    span.end();
  }

  onError(event: HookErrorEvent): void {
    const span = this.tracer.startSpan('db.error');
    span.setAttribute('db.error.code', event.code);
    span.setAttribute('db.error.kind', event.kind);
    if (event.driver) {
      span.setAttribute('db.system.name', event.driver);
    }
    span.recordException(new Error(event.message));
    span.setStatus({ code: SpanStatusCode.ERROR, message: event.code });
    span.end();
  }
}

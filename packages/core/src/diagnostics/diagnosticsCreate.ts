/**
 * Factory for a `Diagnostics` handle bound to a snapshot of
 * `EffectiveDiagnosticsPolicy`.
 *
 * Binding per-operation is what makes in-flight operations safe from
 * concurrent policy changes: each call to `DiagnosticsRuntime.getDiagnostics`
 * or `getContext` passes a freshly resolved policy here, and the returned
 * handle never re-reads the runtime.
 *
 * Span sampling is deterministic: a span is kept when a hash of
 * `scope + name + requestId` falls below the effective `sampleRate`. That
 * means all spans for one request either sample together or not at all, and
 * the same scope/name pair is reproducibly sampled across replays of the
 * same operation.
 */
import type {
  Clock,
  Diagnostics,
  DiagnosticsFieldProvider,
  DiagnosticsRecord,
  DiagnosticsSink,
  EffectiveDiagnosticsPolicy,
  LogLevel,
  Span,
} from './diagnosticsTypes';
import { logLevelIsEnabled } from './diagnosticsTypes';
import { scopeEffectiveLevelResolve } from './diagnosticsPolicyResolve';

function fieldsResolve(
  fields: DiagnosticsFieldProvider | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  if (typeof fields === 'function') {
    try {
      return fields();
    } catch (err) {
      return { __fieldsBuildError: err instanceof Error ? err.message : String(err) };
    }
  }
  return fields;
}

function sampleHash(input: string): number {
  // FNV-1a 32-bit — deterministic, cheap, no crypto dep. Returns in [0, 1).
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function spanSampleDecide(
  scope: string,
  name: string,
  requestId: string | undefined,
  sampleRate: number,
): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  return sampleHash(`${scope}|${name}|${requestId ?? ''}`) < sampleRate;
}

export type DiagnosticsBindArgs = {
  policy: EffectiveDiagnosticsPolicy;
  sink: DiagnosticsSink;
  scope: string;
  clock: Clock;
  requestId?: string;
  workspaceId?: string;
};

export function diagnosticsCreate(args: DiagnosticsBindArgs): Diagnostics {
  const { policy, sink, scope, clock, requestId, workspaceId } = args;
  const effectiveLevel = scopeEffectiveLevelResolve(policy, scope);
  const tracingActive = policy.tracing.enabled;
  const tracingSampleRate = policy.tracing.sampleRate;

  function emit(
    level: LogLevel,
    name: string,
    fields: Record<string, unknown> | undefined,
  ): void {
    if (!logLevelIsEnabled(effectiveLevel, level)) return;
    const record: DiagnosticsRecord = {
      scope,
      level,
      name,
      fields,
      timestampMs: clock.now(),
    };
    sink.write(record);
  }

  const diag: Diagnostics = {
    scope,
    child(childScope) {
      const combined = scope.length === 0
        ? childScope
        : `${scope}.${childScope}`;
      return diagnosticsCreate({
        policy,
        sink,
        scope: combined,
        clock,
        requestId,
        workspaceId,
      });
    },
    enabled(level) {
      return logLevelIsEnabled(effectiveLevel, level);
    },
    error(name, fields) {
      emit('error', name, fields);
    },
    warn(name, fields) {
      emit('warn', name, fields);
    },
    info(name, fields) {
      emit('info', name, fields);
    },
    debug(name, fields) {
      if (!logLevelIsEnabled(effectiveLevel, 'debug')) return;
      emit('debug', name, fieldsResolve(fields));
    },
    trace(name, fields) {
      if (!logLevelIsEnabled(effectiveLevel, 'trace')) return;
      emit('trace', name, fieldsResolve(fields));
    },
    span(name, fields) {
      const enabled = tracingActive
        && logLevelIsEnabled(effectiveLevel, 'debug')
        && spanSampleDecide(scope, name, requestId, tracingSampleRate);
      return spanCreate({
        name,
        fields,
        enabled,
        emit,
        clock,
      });
    },
  };

  return diag;
}

function spanCreate(args: {
  name: string;
  fields: Record<string, unknown> | undefined;
  enabled: boolean;
  emit: (
    level: LogLevel,
    name: string,
    fields: Record<string, unknown> | undefined,
  ) => void;
  clock: Clock;
}): Span {
  const { name, fields, enabled, emit, clock } = args;
  if (!enabled) {
    return { end() { /* no-op */ } };
  }
  const startMs = clock.now();
  emit('debug', `${name}.begin`, fields);
  let ended = false;
  return {
    end(endFields) {
      if (ended) return;
      ended = true;
      const durationMs = clock.now() - startMs;
      emit('debug', `${name}.end`, {
        ...(fields ?? {}),
        ...(endFields ?? {}),
        durationMs,
      });
    },
  };
}

export const systemClock: Clock = {
  now() {
    return Date.now();
  },
};

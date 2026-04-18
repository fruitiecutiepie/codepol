/**
 * Factory for a `Diagnostics` handle bound to a snapshot of `DiagnosticsConfig`.
 *
 * The returned handle is immutable: each call to the runtime's `getDiagnostics`
 * or `getContext` captures the current snapshot so operations in flight do not
 * observe concurrent `setLevel` / `setPolicy` changes mid-flight. Runtime
 * mutations take effect on the next `get*` call.
 *
 * Child scopes inherit their parent dotted scope path and resolve effective
 * level by preferring the most specific override. For example, with
 * `scopes = { "parser": "trace" }`, a `diag.child("adapterCore")` rooted under
 * `parser` resolves as scope `parser.adapterCore`, which inherits `trace`.
 */
import type {
  Clock,
  Diagnostics,
  DiagnosticsConfig,
  DiagnosticsFieldProvider,
  DiagnosticsRecord,
  DiagnosticsSink,
  LogLevel,
  Span,
} from './diagnosticsTypes';
import { logLevelIsEnabled } from './diagnosticsTypes';

function scopeEffectiveLevelGet(
  config: DiagnosticsConfig,
  scope: string,
): LogLevel {
  const override = scopeOverrideResolve(config.scopes, scope);
  return override ?? config.level;
}

function scopeOverrideResolve(
  scopes: Record<string, LogLevel>,
  scope: string,
): LogLevel | undefined {
  if (scope.length === 0) return undefined;
  let candidate = scope;
  while (candidate.length > 0) {
    const hit = scopes[candidate];
    if (hit) return hit;
    const lastDot = candidate.lastIndexOf('.');
    if (lastDot === -1) break;
    candidate = candidate.slice(0, lastDot);
  }
  return undefined;
}

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

export function diagnosticsCreate(args: {
  config: DiagnosticsConfig;
  sink: DiagnosticsSink;
  scope: string;
  clock: Clock;
}): Diagnostics {
  const { config, sink, scope, clock } = args;
  const effectiveLevel = scopeEffectiveLevelGet(config, scope);
  const includePayloads = config.policy.includePayloads;
  const includeTiming = config.policy.includeTiming;

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
      fields: includePayloads ? fields : undefined,
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
        config,
        sink,
        scope: combined,
        clock,
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
      return spanCreate({
        name,
        fields,
        enabled: includeTiming && logLevelIsEnabled(effectiveLevel, 'debug'),
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

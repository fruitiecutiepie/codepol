/**
 * Runtime-owned diagnostics manager.
 *
 * Stores an immutable `DiagnosticsConfig` snapshot plus a composed sink.
 * Mutators (`setLevel`, `setScopeLevel`, `setPolicy`, `setSink`, `setConfig`)
 * produce a new snapshot. Consumers call `getContext` / `getDiagnostics` to
 * capture the current snapshot, so changes never mutate an in-flight
 * `Diagnostics` handle.
 */
import { randomUUID } from 'node:crypto';
import type {
  Clock,
  DebugChecks,
  Diagnostics,
  DiagnosticsConfig,
  DiagnosticsConfigPatch,
  DiagnosticsRuntime,
  DiagnosticsSink,
  ExecutionContext,
  LogLevel,
} from './diagnosticsTypes';
import { diagnosticsCreate, systemClock } from './diagnosticsCreate';
import {
  compositeSinkCreate,
  consoleSinkCreate,
  fileSinkCreate,
  noopSinkCreate,
} from './diagnosticsSinks';

function noopChecksCreate(): DebugChecks {
  return {};
}

function strictChecksCreate(): DebugChecks {
  return {
    validateIndexConsistency(_index) {
      // Placeholder slot: intentionally light. Future: call index invariant
      // validators here. Kept cheap so enabling trace mode stays usable.
    },
  };
}

function sinkBuild(config: DiagnosticsConfig): DiagnosticsSink {
  const sinks: DiagnosticsSink[] = [];
  if (config.sink.consoleEnabled) {
    sinks.push(consoleSinkCreate());
  }
  if (config.sink.logFilePath) {
    sinks.push(fileSinkCreate(config.sink.logFilePath));
  }
  if (sinks.length === 0) {
    return noopSinkCreate();
  }
  if (sinks.length === 1) {
    return sinks[0]!;
  }
  return compositeSinkCreate(sinks);
}

function configPatchApply(
  config: DiagnosticsConfig,
  patch: DiagnosticsConfigPatch,
): DiagnosticsConfig {
  const nextScopes: Record<string, LogLevel> = { ...config.scopes };
  if (patch.scopes) {
    for (const [key, value] of Object.entries(patch.scopes)) {
      if (value === null || value === undefined) {
        delete nextScopes[key];
      } else {
        nextScopes[key] = value;
      }
    }
  }
  const nextSink: DiagnosticsConfig['sink'] = { ...config.sink };
  if (patch.sink) {
    if (patch.sink.consoleEnabled !== undefined) {
      nextSink.consoleEnabled = patch.sink.consoleEnabled;
    }
    if (patch.sink.logFilePath !== undefined) {
      if (patch.sink.logFilePath === null || patch.sink.logFilePath === '') {
        delete nextSink.logFilePath;
      } else {
        nextSink.logFilePath = patch.sink.logFilePath;
      }
    }
  }
  return {
    level: patch.level ?? config.level,
    scopes: nextScopes,
    policy: {
      ...config.policy,
      ...(patch.policy ?? {}),
    },
    sink: nextSink,
  };
}

export function diagnosticsRuntimeCreate(args: {
  initialConfig: DiagnosticsConfig;
  clock?: Clock;
}): DiagnosticsRuntime {
  const clock = args.clock ?? systemClock;
  let config: DiagnosticsConfig = args.initialConfig;
  let sink: DiagnosticsSink = sinkBuild(config);

  function getDiagnostics(scope: string): Diagnostics {
    return diagnosticsCreate({ config, sink, scope, clock });
  }

  function getContext(
    scope: string,
    opts?: { requestId?: string; abortSignal?: AbortSignal },
  ): ExecutionContext {
    const diag = getDiagnostics(scope);
    const traceLevelActive = diag.enabled('trace');
    return {
      diag,
      clock,
      checks: traceLevelActive ? strictChecksCreate() : noopChecksCreate(),
      requestId: opts?.requestId ?? randomUUID(),
      abortSignal: opts?.abortSignal,
    };
  }

  function applyPatch(patch: DiagnosticsConfigPatch): void {
    const prevLogPath = config.sink.logFilePath;
    const prevConsole = config.sink.consoleEnabled;
    config = configPatchApply(config, patch);
    const logPathChanged = prevLogPath !== config.sink.logFilePath;
    const consoleChanged = prevConsole !== config.sink.consoleEnabled;
    if (logPathChanged || consoleChanged) {
      sink = sinkBuild(config);
    }
  }

  return {
    getContext,
    getDiagnostics,
    getConfig() {
      return {
        level: config.level,
        scopes: { ...config.scopes },
        policy: { ...config.policy },
        sink: { ...config.sink },
      };
    },
    setLevel(level) {
      applyPatch({ level });
    },
    setScopeLevel(scope, level) {
      applyPatch({ scopes: { [scope]: level ?? null } });
    },
    setPolicy(patch) {
      applyPatch({ policy: patch });
    },
    setSink(patch) {
      applyPatch({ sink: patch });
    },
    setConfig(patch) {
      applyPatch(patch);
    },
  };
}

export function diagnosticsConfigDefaults(): DiagnosticsConfig {
  return {
    level: 'warn',
    scopes: {},
    policy: {
      includePayloads: true,
      includeTiming: false,
      includeInternalStateSnapshots: false,
      redaction: 'standard',
    },
    sink: {
      consoleEnabled: true,
    },
  };
}

/**
 * Sink factories for diagnostics output and the redaction-aware pipeline.
 *
 * Sinks are injected capabilities — business code never imports them
 * directly. The runtime builds a composite pipeline from the kinds listed in
 * the effective `RuntimeDiagnosticsPolicy.sinks`, wraps it in the current
 * `RedactionExecutor`, and swaps the whole pipeline whenever configuration
 * or redaction mode changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  DiagnosticSinkKind,
  DiagnosticsRecord,
  DiagnosticsSink,
} from './diagnosticsTypes';
import type { RedactionExecutor } from './diagnosticsRedaction';

function recordFormat(record: DiagnosticsRecord): string {
  const base = {
    ts: new Date(record.timestampMs).toISOString(),
    lvl: record.level,
    scope: record.scope,
    name: record.name,
    ...(record.fields ?? {}),
  };
  return JSON.stringify(base);
}

export function consoleSinkCreate(): DiagnosticsSink {
  return {
    write(record) {
      console.error(recordFormat(record));
    },
  };
}

export function stdoutSinkCreate(): DiagnosticsSink {
  return {
    write(record) {
      process.stdout.write(`${recordFormat(record)}\n`);
    },
  };
}

export function fileSinkCreate(logFilePath: string): DiagnosticsSink {
  const resolved = path.resolve(logFilePath);
  let openFailed = false;
  let headerWritten = false;

  function ensureOpen(): boolean {
    if (openFailed) return false;
    if (headerWritten) return true;
    try {
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(
        resolved,
        `\n=== [codepol-diagnostics] session pid=${process.pid} started=${new Date().toISOString()} path=${resolved} ===\n`,
      );
      headerWritten = true;
      return true;
    } catch {
      openFailed = true;
      return false;
    }
  }

  return {
    write(record) {
      if (!ensureOpen()) return;
      try {
        fs.appendFileSync(resolved, `${recordFormat(record)}\n`);
      } catch {
        openFailed = true;
      }
    },
  };
}

export type MemorySink = DiagnosticsSink & {
  snapshot(): readonly DiagnosticsRecord[];
  clear(): void;
  size(): number;
};

/**
 * Ring-buffer sink intended for tests. Keeps the most recent `capacity`
 * records; `snapshot()` returns a defensive copy in emission order.
 */
export function memorySinkCreate(capacity = 1024): MemorySink {
  const buffer: DiagnosticsRecord[] = [];
  return {
    write(record) {
      buffer.push(record);
      if (buffer.length > capacity) {
        buffer.splice(0, buffer.length - capacity);
      }
    },
    snapshot() {
      return [...buffer];
    },
    clear() {
      buffer.length = 0;
    },
    size() {
      return buffer.length;
    },
  };
}

/**
 * Stub OTEL sink. Emits a single warning the first time it's written to and
 * then no-ops. Kept as a placeholder until a real exporter is added.
 */
export function otelSinkCreate(endpoint: string | undefined): DiagnosticsSink {
  let warned = false;
  return {
    write(record) {
      if (!warned) {
        warned = true;
        console.warn(
          `[codepol-diagnostics] otel sink requested (endpoint=${endpoint ?? '<unset>'}) but no exporter is bundled; dropping record ${record.name}.`,
        );
      }
    },
  };
}

export function compositeSinkCreate(sinks: DiagnosticsSink[]): DiagnosticsSink {
  return {
    write(record) {
      for (const sink of sinks) {
        try {
          sink.write(record);
        } catch {
          // swallow per-sink errors to keep diagnostics non-fatal
        }
      }
    },
    close() {
      for (const sink of sinks) {
        try {
          sink.close?.();
        } catch {
          // ignore
        }
      }
    },
  };
}

export function noopSinkCreate(): DiagnosticsSink {
  return {
    write() {
      // no-op
    },
  };
}

export type SinkFactories = {
  memoryOverride?: MemorySink;
  consoleOverride?: DiagnosticsSink;
  stdoutOverride?: DiagnosticsSink;
  fileOverride?: (logFilePath: string) => DiagnosticsSink;
  otelOverride?: (endpoint: string | undefined) => DiagnosticsSink;
};

export type SinkPipelineArgs = {
  kinds: readonly DiagnosticSinkKind[];
  redaction: RedactionExecutor;
  logFilePath?: string;
  otelEndpoint?: string;
  factories?: SinkFactories;
};

/**
 * Builds the composite redact-then-dispatch pipeline described by the active
 * policy. `factories` lets tests inject a specific `MemorySink` instance so
 * they can inspect emissions.
 */
export function sinkPipelineCreate(args: SinkPipelineArgs): DiagnosticsSink {
  const { kinds, redaction, logFilePath, otelEndpoint, factories } = args;
  const sinks: DiagnosticsSink[] = [];
  const seen = new Set<DiagnosticSinkKind>();
  for (const kind of kinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    switch (kind) {
      case 'console':
        sinks.push(factories?.consoleOverride ?? consoleSinkCreate());
        break;
      case 'stdout':
        sinks.push(factories?.stdoutOverride ?? stdoutSinkCreate());
        break;
      case 'file':
        if (logFilePath) {
          sinks.push(
            factories?.fileOverride
              ? factories.fileOverride(logFilePath)
              : fileSinkCreate(logFilePath),
          );
        }
        break;
      case 'memory':
        sinks.push(factories?.memoryOverride ?? memorySinkCreate());
        break;
      case 'otel':
        sinks.push(
          factories?.otelOverride
            ? factories.otelOverride(otelEndpoint)
            : otelSinkCreate(otelEndpoint),
        );
        break;
    }
  }

  const dispatch = sinks.length === 0
    ? noopSinkCreate()
    : sinks.length === 1
      ? sinks[0]!
      : compositeSinkCreate(sinks);

  if (redaction.mode === 'off') {
    return dispatch;
  }

  return {
    write(record) {
      dispatch.write(redaction.redactRecord(record));
    },
    close() {
      dispatch.close?.();
    },
  };
}

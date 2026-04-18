/**
 * Sink factories for diagnostics output.
 *
 * Sinks are injected capabilities — business code never imports them
 * directly. The runtime composes a console sink and/or a file sink based on
 * its current `DiagnosticsConfig.sink`, and swaps the composite sink whenever
 * configuration changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DiagnosticsRecord, DiagnosticsSink } from './diagnosticsTypes';

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
      const line = recordFormat(record);
      if (record.level === 'error' || record.level === 'warn') {
        console.error(line);
      } else {
        console.error(line);
      }
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

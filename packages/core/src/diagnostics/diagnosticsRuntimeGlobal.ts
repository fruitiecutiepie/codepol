/**
 * Process-wide singleton `DiagnosticsRuntime`.
 *
 * Seeds initial configuration once from env vars so back-compat users setting
 * `CODEPOL_DEBUG_PARSE=1` / `CODEPOL_DEBUG_PARSE_FILE=/tmp/x.log` keep working.
 * After the first read, the env is ignored — only the runtime API (directly,
 * or via CLI / LSP / VSCode command relays) mutates state. This prevents the
 * old bug where changing `CODEPOL_DEBUG_PARSE_FILE` at runtime had no effect
 * because the log path was cached on first use.
 */
import type {
  DiagnosticsConfig,
  DiagnosticsRuntime,
  LogLevel,
} from './diagnosticsTypes';
import {
  diagnosticsConfigDefaults,
  diagnosticsRuntimeCreate,
} from './diagnosticsRuntimeCreate';

const diagnosticsRuntimeKey = Symbol.for('codepol.diagnostics-runtime');

type GlobalWithRuntime = typeof globalThis & {
  [diagnosticsRuntimeKey]?: DiagnosticsRuntime;
};

function envTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim().toLowerCase();
  return trimmed !== '' && trimmed !== '0' && trimmed !== 'false';
}

function envLevelParse(raw: string | undefined): LogLevel | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  switch (trimmed) {
    case 'error':
    case 'warn':
    case 'info':
    case 'debug':
    case 'trace':
      return trimmed;
    default:
      return undefined;
  }
}

function envSeedBuild(env: NodeJS.ProcessEnv): DiagnosticsConfig {
  const base = diagnosticsConfigDefaults();
  const explicitLevel = envLevelParse(env.CODEPOL_DIAGNOSTICS_LEVEL);
  const debugParseEnabled = envTruthy(env.CODEPOL_DEBUG_PARSE);
  const level: LogLevel = explicitLevel
    ?? (debugParseEnabled ? 'debug' : base.level);
  const scopes: Record<string, LogLevel> = {};
  if (debugParseEnabled) {
    scopes['parser'] = 'debug';
    scopes['workspace.analyzer'] = 'debug';
  }
  const logFilePath = env.CODEPOL_DEBUG_PARSE_FILE?.trim()
    || env.CODEPOL_DIAGNOSTICS_LOG_FILE?.trim()
    || undefined;
  return {
    ...base,
    level,
    scopes,
    policy: {
      ...base.policy,
      includeTiming: debugParseEnabled || explicitLevel === 'trace',
    },
    sink: {
      consoleEnabled: base.sink.consoleEnabled,
      logFilePath,
    },
  };
}

export function diagnosticsRuntimeGet(): DiagnosticsRuntime {
  const g = globalThis as GlobalWithRuntime;
  if (!g[diagnosticsRuntimeKey]) {
    g[diagnosticsRuntimeKey] = diagnosticsRuntimeCreate({
      initialConfig: envSeedBuild(process.env),
    });
  }
  return g[diagnosticsRuntimeKey]!;
}

/** Test-only: replace the global runtime. Not exported from the package. */
export function diagnosticsRuntimeSetForTest(
  runtime: DiagnosticsRuntime | undefined,
): void {
  const g = globalThis as GlobalWithRuntime;
  if (runtime === undefined) {
    delete g[diagnosticsRuntimeKey];
  } else {
    g[diagnosticsRuntimeKey] = runtime;
  }
}

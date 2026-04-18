/**
 * Process-wide singleton `DiagnosticsRuntime`.
 *
 * Seeds initial state from `CODEPOL_ENV` (or `NODE_ENV`) first, then overlays
 * legacy `CODEPOL_DEBUG_PARSE` / `CODEPOL_DEBUG_PARSE_FILE` /
 * `CODEPOL_DIAGNOSTICS_LEVEL` / `CODEPOL_DIAGNOSTICS_LOG_FILE` as overrides.
 * After the singleton is built the env is ignored — only the runtime API
 * (directly or via CLI / daemon IPC / LSP / VSCode command relays) mutates
 * state. This preserves back-compat while making the control flow
 * unambiguous.
 */
import type {
  DiagnosticSinkKind,
  DiagnosticsOverridePatch,
  DiagnosticsRuntime,
  EnvironmentName,
  LogLevel,
} from './diagnosticsTypes';
import { diagnosticsRuntimeCreate } from './diagnosticsRuntimeCreate';
import { environmentNameParse } from './diagnosticsPresets';

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

function environmentFromEnv(env: NodeJS.ProcessEnv): EnvironmentName {
  const explicit = environmentNameParse(env.CODEPOL_ENV);
  if (explicit) return explicit;
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === 'development') return 'dev';
  if (nodeEnv === 'test') return 'test';
  return 'user';
}

function legacyOverridesFromEnv(env: NodeJS.ProcessEnv): DiagnosticsOverridePatch {
  const patch: DiagnosticsOverridePatch = {};
  const explicitLevel = envLevelParse(env.CODEPOL_DIAGNOSTICS_LEVEL);
  const debugParseEnabled = envTruthy(env.CODEPOL_DEBUG_PARSE);
  if (explicitLevel) {
    patch.level = explicitLevel;
  } else if (debugParseEnabled) {
    patch.level = 'debug';
    patch.scopes = {
      parser: 'debug',
      'workspace.analyzer': 'debug',
    };
  }
  if (debugParseEnabled || explicitLevel === 'trace') {
    patch.tracing = { enabled: true };
  }
  const logFilePath = env.CODEPOL_DEBUG_PARSE_FILE?.trim()
    || env.CODEPOL_DIAGNOSTICS_LOG_FILE?.trim()
    || undefined;
  if (logFilePath) {
    patch.logFilePath = logFilePath;
    // ensure the file sink is present without stomping other sinks entirely
    patch.sinks = sinksEnsureFile(patch.sinks);
  }
  return patch;
}

function sinksEnsureFile(
  existing: readonly DiagnosticSinkKind[] | undefined,
): readonly DiagnosticSinkKind[] | undefined {
  if (!existing) return undefined;
  if (existing.includes('file')) return existing;
  return [...existing, 'file'];
}

export function diagnosticsRuntimeGet(): DiagnosticsRuntime {
  const g = globalThis as GlobalWithRuntime;
  if (!g[diagnosticsRuntimeKey]) {
    const environment = environmentFromEnv(process.env);
    const legacyOverrides = legacyOverridesFromEnv(process.env);
    const runtime = diagnosticsRuntimeCreate({ environment });
    if (Object.keys(legacyOverrides).length > 0) {
      runtime.setOverrides(legacyOverrides);
    }
    g[diagnosticsRuntimeKey] = runtime;
  }
  return g[diagnosticsRuntimeKey]!;
}

/** Test-only: replace the global runtime. */
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

/** Test-only: reset to the initial seed. */
export function diagnosticsRuntimeResetForTest(): void {
  const g = globalThis as GlobalWithRuntime;
  delete g[diagnosticsRuntimeKey];
}

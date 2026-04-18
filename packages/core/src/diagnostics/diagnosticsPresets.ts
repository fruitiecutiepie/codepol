/**
 * Environment presets as data.
 *
 * Each preset is a named `RuntimeDiagnosticsPolicy` bundle optimized for a
 * specific job:
 *   user     — safe field posture; what end users run by default.
 *   dev      — productive daily engineering posture.
 *   test     — deterministic verification for CI / unit tests.
 *   verbose  — explicit investigation posture, the only preset that is truly loud.
 *
 * Every preset sets `checks.invariants` explicitly so a level bump never
 * silently implies a check-depth change. Sinks listed here are the preset
 * default; interactive entry points (CLI with TTY, LSP which owns stdout,
 * etc.) may add or swap them based on their own wiring.
 */
import type {
  EnvironmentName,
  EnvironmentPreset,
  RuntimeDiagnosticsPolicy,
} from './diagnosticsTypes';

const userPresetPolicy: RuntimeDiagnosticsPolicy = {
  level: 'warn',
  scopes: {},
  tracing: { enabled: false, sampleRate: 0 },
  metrics: { enabled: false },
  snapshots: { enabled: false, maxBytes: 0 },
  checks: { invariants: 'off' },
  redaction: { mode: 'strict' },
  sinks: ['stdout'],
};

const devPresetPolicy: RuntimeDiagnosticsPolicy = {
  level: 'debug',
  scopes: {},
  tracing: { enabled: true, sampleRate: 0.2 },
  metrics: { enabled: true },
  snapshots: { enabled: true, maxBytes: 1_048_576 },
  checks: { invariants: 'cheap' },
  redaction: { mode: 'standard' },
  sinks: ['console', 'file'],
};

const testPresetPolicy: RuntimeDiagnosticsPolicy = {
  level: 'warn',
  scopes: {},
  tracing: { enabled: false, sampleRate: 0 },
  metrics: { enabled: false },
  snapshots: { enabled: false, maxBytes: 0 },
  checks: { invariants: 'cheap' },
  redaction: { mode: 'off' },
  sinks: ['memory'],
};

const verbosePresetPolicy: RuntimeDiagnosticsPolicy = {
  level: 'trace',
  scopes: {},
  tracing: { enabled: true, sampleRate: 1.0 },
  metrics: { enabled: true },
  snapshots: { enabled: true, maxBytes: 8_388_608 },
  checks: { invariants: 'full' },
  redaction: { mode: 'standard' },
  sinks: ['console', 'file'],
};

export const ENV_PRESETS: Record<EnvironmentName, EnvironmentPreset> = {
  user: { name: 'user', diagnostics: userPresetPolicy },
  dev: { name: 'dev', diagnostics: devPresetPolicy },
  test: { name: 'test', diagnostics: testPresetPolicy },
  verbose: { name: 'verbose', diagnostics: verbosePresetPolicy },
};

export function environmentPresetGet(name: EnvironmentName): EnvironmentPreset {
  return ENV_PRESETS[name];
}

export function environmentPresetPolicyClone(
  name: EnvironmentName,
): RuntimeDiagnosticsPolicy {
  const preset = ENV_PRESETS[name];
  return {
    level: preset.diagnostics.level,
    scopes: { ...preset.diagnostics.scopes },
    tracing: { ...preset.diagnostics.tracing },
    metrics: { ...preset.diagnostics.metrics },
    snapshots: { ...preset.diagnostics.snapshots },
    checks: { ...preset.diagnostics.checks },
    redaction: { ...preset.diagnostics.redaction },
    sinks: [...preset.diagnostics.sinks],
    logFilePath: preset.diagnostics.logFilePath,
    otelEndpoint: preset.diagnostics.otelEndpoint,
  };
}

const ENVIRONMENT_NAMES: readonly EnvironmentName[] = [
  'user',
  'dev',
  'test',
  'verbose',
];

export function environmentNameParse(
  raw: string | undefined,
): EnvironmentName | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  return (ENVIRONMENT_NAMES as readonly string[]).includes(trimmed)
    ? (trimmed as EnvironmentName)
    : undefined;
}

export function environmentNamesList(): readonly EnvironmentName[] {
  return ENVIRONMENT_NAMES;
}

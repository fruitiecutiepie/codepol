/**
 * Runtime-configurable diagnostics/observability types.
 *
 * Business functions (parser, workspace analyzer, plugins) depend on
 * `Diagnostics` / `ExecutionContext` instead of reading env vars or module-local
 * flags. A single `DiagnosticsRuntime` owns the active configuration and
 * exposes setters for CLI flags, LSP commands, and VSCode settings to drive.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type DiagnosticsPolicy = {
  /** Include caller-supplied structured fields on events. */
  includePayloads: boolean;
  /** Emit `span` begin/end events with durationMs. */
  includeTiming: boolean;
  /** Permit verbose internal state snapshots (trees, large dumps). */
  includeInternalStateSnapshots: boolean;
  /** Redaction posture for emitted fields. */
  redaction: 'strict' | 'standard' | 'off';
};

export type DiagnosticsSinkConfig = {
  consoleEnabled: boolean;
  logFilePath?: string;
};

export type DiagnosticsConfig = {
  level: LogLevel;
  scopes: Record<string, LogLevel>;
  policy: DiagnosticsPolicy;
  sink: DiagnosticsSinkConfig;
};

export type DiagnosticsFieldProvider =
  | Record<string, unknown>
  | (() => Record<string, unknown>);

export type DiagnosticsRecord = {
  scope: string;
  level: LogLevel;
  name: string;
  fields?: Record<string, unknown>;
  timestampMs: number;
};

export type DiagnosticsSink = {
  write(record: DiagnosticsRecord): void;
  close?(): void;
};

export type Span = {
  end(fields?: Record<string, unknown>): void;
};

export type Diagnostics = {
  readonly scope: string;
  child(scope: string): Diagnostics;
  enabled(level: LogLevel): boolean;
  error(name: string, fields?: Record<string, unknown>): void;
  warn(name: string, fields?: Record<string, unknown>): void;
  info(name: string, fields?: Record<string, unknown>): void;
  debug(name: string, fields?: DiagnosticsFieldProvider): void;
  trace(name: string, fields?: DiagnosticsFieldProvider): void;
  span(name: string, fields?: Record<string, unknown>): Span;
};

export type Clock = {
  now(): number;
};

export type DebugChecks = {
  /** Optional expensive validation; implementations may be no-ops. */
  validateIndexConsistency?(index: unknown): void;
};

export type ExecutionContext = {
  diag: Diagnostics;
  clock: Clock;
  checks: DebugChecks;
  requestId: string;
  abortSignal?: AbortSignal;
};

export type DiagnosticsRuntime = {
  getContext(scope: string, opts?: {
    requestId?: string;
    abortSignal?: AbortSignal;
  }): ExecutionContext;
  getDiagnostics(scope: string): Diagnostics;
  getConfig(): DiagnosticsConfig;
  setLevel(level: LogLevel): void;
  setScopeLevel(scope: string, level: LogLevel | undefined): void;
  setPolicy(patch: Partial<DiagnosticsPolicy>): void;
  setSink(patch: { consoleEnabled?: boolean; logFilePath?: string | null }): void;
  setConfig(patch: DiagnosticsConfigPatch): void;
};

export type DiagnosticsConfigPatch = {
  level?: LogLevel;
  scopes?: Record<string, LogLevel | null>;
  policy?: Partial<DiagnosticsPolicy>;
  sink?: { consoleEnabled?: boolean; logFilePath?: string | null };
};

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

export function logLevelIsEnabled(active: LogLevel, check: LogLevel): boolean {
  return LOG_LEVEL_ORDER[check] <= LOG_LEVEL_ORDER[active];
}

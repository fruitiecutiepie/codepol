/**
 * Runtime-configurable diagnostics/observability types.
 *
 * The model is two-axis:
 *   - `ShippedDebugCapabilities` is compile-time — what the binary can do.
 *   - `RuntimeDiagnosticsPolicy` is runtime — what is currently active.
 *
 * The active behaviour at any moment is `policy ∩ shipped`, expressed as
 * `EffectiveDiagnosticsPolicy`. Business functions depend only on the
 * `Diagnostics` / `ExecutionContext` interfaces and never see the environment
 * name or the underlying policy shape.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type EnvironmentName = 'user' | 'dev' | 'test' | 'verbose';

export type DiagnosticSinkKind =
  | 'console'
  | 'file'
  | 'memory'
  | 'stdout'
  | 'otel';

export type RedactionMode = 'strict' | 'standard' | 'off';

export type InvariantCheckDepth = 'off' | 'cheap' | 'full';

/**
 * Compile-time capabilities that determine what the binary can possibly do.
 * A hardened release may ship with some of these set to `false`, at which
 * point runtime policy cannot enable them.
 */
export type ShippedDebugCapabilities = {
  deepStateSnapshots: boolean;
  invariantChecks: boolean;
  traceSpans: boolean;
  profiling: boolean;
  faultInjection: boolean;
  adminInspectors: boolean;
  allowedSinks: readonly DiagnosticSinkKind[];
  allowedMaxLevel: LogLevel;
};

export type TracingPolicy = {
  enabled: boolean;
  /** Probability in [0, 1]. */
  sampleRate: number;
};

export type MetricsPolicy = {
  enabled: boolean;
};

export type SnapshotsPolicy = {
  enabled: boolean;
  maxBytes: number;
};

export type ChecksPolicy = {
  invariants: InvariantCheckDepth;
};

export type RedactionPolicy = {
  mode: RedactionMode;
};

/**
 * Runtime diagnostics policy — orthogonal dimensions that together describe
 * the current observability posture.
 */
export type RuntimeDiagnosticsPolicy = {
  level: LogLevel;
  scopes: Record<string, LogLevel>;
  tracing: TracingPolicy;
  metrics: MetricsPolicy;
  snapshots: SnapshotsPolicy;
  checks: ChecksPolicy;
  redaction: RedactionPolicy;
  sinks: readonly DiagnosticSinkKind[];
  /** Present only when `sinks` includes `'file'`. */
  logFilePath?: string;
  /** Present only when `sinks` includes `'otel'`. */
  otelEndpoint?: string;
};

export type EnvironmentPreset = {
  name: EnvironmentName;
  diagnostics: RuntimeDiagnosticsPolicy;
};

/**
 * Scope targeting for a single escalation. `global` applies to every
 * operation; the others activate only when the matching identifier is
 * provided to `getContext` (or inferable from scope).
 */
export type EscalationScope =
  | { kind: 'global' }
  | { kind: 'scope'; scope: string }
  | { kind: 'request'; requestId: string }
  | { kind: 'workspace'; workspaceId: string };

export type EscalationRule = {
  id: string;
  scope: EscalationScope;
  level: LogLevel;
  policyOverrides?: Partial<RuntimeDiagnosticsPolicy>;
  expiresAtUnixMs: number;
  reason: string;
  actor: string;
};

/**
 * An `EscalationRule` with its `id`/`expiresAtUnixMs` populated after
 * registration. Callers store the handle to `revoke()` early.
 */
export type EscalationHandle = {
  id: string;
  expiresAtUnixMs: number;
  revoke(): void;
};

/**
 * Policy actually in force for a given operation after applying the preset,
 * overrides, any matching active escalations, and the capability intersection.
 */
export type EffectiveDiagnosticsPolicy = RuntimeDiagnosticsPolicy & {
  environment: EnvironmentName;
  shipped: ShippedDebugCapabilities;
  /** Escalations that contributed to the effective shape for this resolution. */
  activeEscalations: readonly EscalationRule[];
};

/**
 * Stored runtime state. Preset is a copy of the preset for the current
 * environment so that `setOverrides` leaves it intact.
 */
export type DiagnosticsConfig = {
  environment: EnvironmentName;
  preset: RuntimeDiagnosticsPolicy;
  overrides: Partial<RuntimeDiagnosticsPolicy>;
  escalations: readonly EscalationRule[];
};

export type DiagnosticsConfigPatch = {
  environment?: EnvironmentName;
  /** Shallow merge; use `null` on scope entries to clear an override. */
  overrides?: DiagnosticsOverridePatch;
  /** Replace the entire escalation list (caller should usually read-modify-write). */
  escalations?: readonly EscalationRule[];
};

export type DiagnosticsOverridePatch = {
  level?: LogLevel;
  scopes?: Record<string, LogLevel | null>;
  tracing?: Partial<TracingPolicy>;
  metrics?: Partial<MetricsPolicy>;
  snapshots?: Partial<SnapshotsPolicy>;
  checks?: Partial<ChecksPolicy>;
  redaction?: Partial<RedactionPolicy>;
  sinks?: readonly DiagnosticSinkKind[];
  logFilePath?: string | null;
  otelEndpoint?: string | null;
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

export type ExecutionContextScopeOpts = {
  requestId?: string;
  workspaceId?: string;
  abortSignal?: AbortSignal;
};

export type ExecutionContext = {
  diag: Diagnostics;
  clock: Clock;
  checks: DebugChecks;
  requestId: string;
  workspaceId?: string;
  abortSignal?: AbortSignal;
};

export type DiagnosticsRuntime = {
  getContext(scope: string, opts?: ExecutionContextScopeOpts): ExecutionContext;
  getDiagnostics(scope: string, opts?: { requestId?: string; workspaceId?: string }): Diagnostics;
  getConfig(): DiagnosticsConfig;
  getEffectivePolicy(opts?: {
    scope?: string;
    requestId?: string;
    workspaceId?: string;
  }): EffectiveDiagnosticsPolicy;
  setEnvironment(environment: EnvironmentName): void;
  setOverrides(patch: DiagnosticsOverridePatch): void;
  setConfig(patch: DiagnosticsConfigPatch): void;
  escalate(rule: EscalationRuleInput): EscalationHandle;
  revokeEscalation(id: string): boolean;
  listEscalations(): readonly EscalationRule[];
};

/**
 * Input to `escalate` before the store assigns `id`/`expiresAtUnixMs`.
 */
export type EscalationRuleInput = {
  id?: string;
  scope: EscalationScope;
  level: LogLevel;
  policyOverrides?: Partial<RuntimeDiagnosticsPolicy>;
  ttlMs: number;
  reason: string;
  actor: string;
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

export function logLevelMax(a: LogLevel, b: LogLevel): LogLevel {
  return LOG_LEVEL_ORDER[a] >= LOG_LEVEL_ORDER[b] ? a : b;
}

export function logLevelMin(a: LogLevel, b: LogLevel): LogLevel {
  return LOG_LEVEL_ORDER[a] <= LOG_LEVEL_ORDER[b] ? a : b;
}

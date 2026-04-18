/**
 * Pure resolver: `effective = preset + overrides + active escalations` then
 * clamped/filtered against `ShippedDebugCapabilities`. No side effects.
 *
 * Resolution order matters: overrides stack on top of the preset, then any
 * escalation whose scope matches this resolution adds its `level` (via max)
 * and `policyOverrides` (via shallow merge). Finally the capability layer
 * subtracts what the binary did not ship.
 *
 * The resolver takes a clock-dependent `nowMs` parameter instead of reading
 * the clock itself so callers can reason about exactly which escalations
 * were active for a given operation.
 */
import type {
  DiagnosticSinkKind,
  DiagnosticsConfig,
  EffectiveDiagnosticsPolicy,
  EscalationRule,
  LogLevel,
  RuntimeDiagnosticsPolicy,
  ShippedDebugCapabilities,
} from './diagnosticsTypes';
import { LOG_LEVEL_ORDER, logLevelMax, logLevelMin } from './diagnosticsTypes';

export type PolicyResolveOpts = {
  scope?: string;
  requestId?: string;
  workspaceId?: string;
};

function policyClone(policy: RuntimeDiagnosticsPolicy): RuntimeDiagnosticsPolicy {
  return {
    level: policy.level,
    scopes: { ...policy.scopes },
    tracing: { ...policy.tracing },
    metrics: { ...policy.metrics },
    snapshots: { ...policy.snapshots },
    checks: { ...policy.checks },
    redaction: { ...policy.redaction },
    sinks: [...policy.sinks],
    logFilePath: policy.logFilePath,
    otelEndpoint: policy.otelEndpoint,
  };
}

function scopeInheritMatches(baseScope: string, escalationScope: string): boolean {
  if (baseScope === escalationScope) return true;
  if (baseScope.startsWith(`${escalationScope}.`)) return true;
  return false;
}

function escalationMatches(rule: EscalationRule, opts: PolicyResolveOpts): boolean {
  switch (rule.scope.kind) {
    case 'global':
      return true;
    case 'scope':
      return opts.scope !== undefined
        && scopeInheritMatches(opts.scope, rule.scope.scope);
    case 'request':
      return opts.requestId !== undefined
        && opts.requestId === rule.scope.requestId;
    case 'workspace':
      return opts.workspaceId !== undefined
        && opts.workspaceId === rule.scope.workspaceId;
  }
}

function escalationsActive(
  escalations: readonly EscalationRule[],
  nowMs: number,
  opts: PolicyResolveOpts,
): EscalationRule[] {
  const active: EscalationRule[] = [];
  for (const rule of escalations) {
    if (rule.expiresAtUnixMs <= nowMs) continue;
    if (!escalationMatches(rule, opts)) continue;
    active.push(rule);
  }
  return active;
}

function policyOverridesApply(
  base: RuntimeDiagnosticsPolicy,
  overrides: Partial<RuntimeDiagnosticsPolicy> | undefined,
): RuntimeDiagnosticsPolicy {
  if (!overrides) return base;
  const next = policyClone(base);
  if (overrides.level) next.level = overrides.level;
  if (overrides.scopes) {
    next.scopes = { ...next.scopes, ...overrides.scopes };
  }
  if (overrides.tracing) {
    next.tracing = { ...next.tracing, ...overrides.tracing };
  }
  if (overrides.metrics) {
    next.metrics = { ...next.metrics, ...overrides.metrics };
  }
  if (overrides.snapshots) {
    next.snapshots = { ...next.snapshots, ...overrides.snapshots };
  }
  if (overrides.checks) {
    next.checks = { ...next.checks, ...overrides.checks };
  }
  if (overrides.redaction) {
    next.redaction = { ...next.redaction, ...overrides.redaction };
  }
  if (overrides.sinks) {
    next.sinks = [...overrides.sinks];
  }
  if (overrides.logFilePath !== undefined) {
    next.logFilePath = overrides.logFilePath || undefined;
  }
  if (overrides.otelEndpoint !== undefined) {
    next.otelEndpoint = overrides.otelEndpoint || undefined;
  }
  return next;
}

function sinksFilterToAllowed(
  sinks: readonly DiagnosticSinkKind[],
  allowed: readonly DiagnosticSinkKind[],
): DiagnosticSinkKind[] {
  const allowedSet = new Set(allowed);
  return sinks.filter((kind) => allowedSet.has(kind));
}

function capabilityClamp(
  policy: RuntimeDiagnosticsPolicy,
  shipped: ShippedDebugCapabilities,
): RuntimeDiagnosticsPolicy {
  const clamped = policyClone(policy);
  if (LOG_LEVEL_ORDER[clamped.level] > LOG_LEVEL_ORDER[shipped.allowedMaxLevel]) {
    clamped.level = shipped.allowedMaxLevel;
  }
  for (const scope of Object.keys(clamped.scopes)) {
    const entry = clamped.scopes[scope]!;
    if (LOG_LEVEL_ORDER[entry] > LOG_LEVEL_ORDER[shipped.allowedMaxLevel]) {
      clamped.scopes[scope] = shipped.allowedMaxLevel;
    }
  }
  if (!shipped.traceSpans) {
    clamped.tracing = { ...clamped.tracing, enabled: false, sampleRate: 0 };
  }
  if (!shipped.deepStateSnapshots) {
    clamped.snapshots = { ...clamped.snapshots, enabled: false };
  }
  if (!shipped.invariantChecks) {
    clamped.checks = { invariants: 'off' };
  }
  clamped.sinks = sinksFilterToAllowed(clamped.sinks, shipped.allowedSinks);
  if (!clamped.sinks.includes('file')) clamped.logFilePath = undefined;
  if (!clamped.sinks.includes('otel')) clamped.otelEndpoint = undefined;
  if (clamped.tracing.sampleRate < 0) clamped.tracing.sampleRate = 0;
  if (clamped.tracing.sampleRate > 1) clamped.tracing.sampleRate = 1;
  if (!clamped.tracing.enabled) clamped.tracing.sampleRate = 0;
  return clamped;
}

export function effectivePolicyResolve(args: {
  config: DiagnosticsConfig;
  shipped: ShippedDebugCapabilities;
  nowMs: number;
  opts?: PolicyResolveOpts;
}): EffectiveDiagnosticsPolicy {
  const { config, shipped, nowMs } = args;
  const opts = args.opts ?? {};
  const withOverrides = policyOverridesApply(config.preset, config.overrides);
  const activeEscalations = escalationsActive(config.escalations, nowMs, opts);

  let withEscalations = withOverrides;
  for (const rule of activeEscalations) {
    const nextLevel = logLevelMax(withEscalations.level, rule.level);
    const merged = policyOverridesApply(withEscalations, rule.policyOverrides);
    withEscalations = { ...merged, level: nextLevel };
    if (opts.scope && rule.scope.kind === 'scope') {
      const nextScopes = { ...withEscalations.scopes };
      const existing = nextScopes[rule.scope.scope];
      nextScopes[rule.scope.scope] = existing
        ? logLevelMax(existing, rule.level)
        : rule.level;
      withEscalations = { ...withEscalations, scopes: nextScopes };
    }
  }

  const clamped = capabilityClamp(withEscalations, shipped);
  return {
    ...clamped,
    environment: config.environment,
    shipped,
    activeEscalations,
  };
}

export function scopeEffectiveLevelResolve(
  policy: EffectiveDiagnosticsPolicy,
  scope: string,
): LogLevel {
  const override = scopeOverrideResolve(policy.scopes, scope);
  return override
    ? logLevelMin(override, policy.shipped.allowedMaxLevel)
    : policy.level;
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

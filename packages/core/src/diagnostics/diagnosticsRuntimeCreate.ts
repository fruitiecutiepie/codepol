/**
 * Runtime-owned diagnostics manager.
 *
 * Stores `{ environment, preset, overrides, escalations }` and resolves the
 * effective policy on every `getContext` / `getDiagnostics` call. Mutators
 * (`setEnvironment`, `setOverrides`, `setConfig`, `escalate`,
 * `revokeEscalation`) produce new state and rebuild the sink pipeline when
 * sink-relevant dimensions change.
 *
 * Operations in flight keep their bound `EffectiveDiagnosticsPolicy`
 * snapshot, so concurrent mutations never mutate an already-returned
 * `Diagnostics` handle.
 */
import { randomUUID } from 'node:crypto';
import type {
  Clock,
  DebugChecks,
  Diagnostics,
  DiagnosticsConfig,
  DiagnosticsConfigPatch,
  DiagnosticsOverridePatch,
  DiagnosticsRuntime,
  DiagnosticsSink,
  EffectiveDiagnosticsPolicy,
  EnvironmentName,
  EscalationHandle,
  EscalationRule,
  EscalationRuleInput,
  ExecutionContext,
  ExecutionContextScopeOpts,
  LogLevel,
  RuntimeDiagnosticsPolicy,
  ShippedDebugCapabilities,
} from './diagnosticsTypes';
import { diagnosticsCreate, systemClock } from './diagnosticsCreate';
import {
  effectivePolicyResolve,
  type PolicyResolveOpts,
} from './diagnosticsPolicyResolve';
import {
  environmentPresetPolicyClone,
} from './diagnosticsPresets';
import {
  redactionPolicyCreate,
  type RedactionExecutor,
} from './diagnosticsRedaction';
import {
  sinkPipelineCreate,
  type SinkFactories,
} from './diagnosticsSinks';
import {
  escalationStoreCreate,
  type EscalationStore,
} from './diagnosticsEscalate';
import { shippedDebugCapabilitiesGet } from './diagnosticsShipped';

const AUDIT_SCOPE = 'diagnostics.audit';

function noopChecksCreate(): DebugChecks {
  return {};
}

function cheapChecksCreate(): DebugChecks {
  return {
    validateIndexConsistency(_index) {
      // intentionally cheap: presence-only smoke checks go here
    },
  };
}

function fullChecksCreate(): DebugChecks {
  return {
    validateIndexConsistency(_index) {
      // placeholder slot: full invariant validators plug in here
    },
  };
}

function checksFromPolicy(policy: EffectiveDiagnosticsPolicy): DebugChecks {
  switch (policy.checks.invariants) {
    case 'off':
      return noopChecksCreate();
    case 'cheap':
      return cheapChecksCreate();
    case 'full':
      return fullChecksCreate();
  }
}

function overridesPatchApply(
  base: Partial<RuntimeDiagnosticsPolicy>,
  patch: DiagnosticsOverridePatch,
): Partial<RuntimeDiagnosticsPolicy> {
  const next: Partial<RuntimeDiagnosticsPolicy> = { ...base };
  if (patch.level !== undefined) next.level = patch.level;
  if (patch.scopes) {
    const scopes: Record<string, LogLevel> = { ...(next.scopes ?? {}) };
    for (const [key, value] of Object.entries(patch.scopes)) {
      if (value === null || value === undefined) {
        delete scopes[key];
      } else {
        scopes[key] = value;
      }
    }
    next.scopes = scopes;
  }
  if (patch.tracing) {
    next.tracing = {
      ...(next.tracing ?? ({} as RuntimeDiagnosticsPolicy['tracing'])),
      ...patch.tracing,
    };
  }
  if (patch.metrics) {
    next.metrics = {
      ...(next.metrics ?? ({} as RuntimeDiagnosticsPolicy['metrics'])),
      ...patch.metrics,
    };
  }
  if (patch.snapshots) {
    next.snapshots = {
      ...(next.snapshots ?? ({} as RuntimeDiagnosticsPolicy['snapshots'])),
      ...patch.snapshots,
    };
  }
  if (patch.checks) {
    next.checks = {
      ...(next.checks ?? ({} as RuntimeDiagnosticsPolicy['checks'])),
      ...patch.checks,
    };
  }
  if (patch.redaction) {
    next.redaction = {
      ...(next.redaction ?? ({} as RuntimeDiagnosticsPolicy['redaction'])),
      ...patch.redaction,
    };
  }
  if (patch.sinks) {
    next.sinks = [...patch.sinks];
  }
  if (patch.logFilePath !== undefined) {
    next.logFilePath = patch.logFilePath === null || patch.logFilePath === ''
      ? undefined
      : patch.logFilePath;
  }
  if (patch.otelEndpoint !== undefined) {
    next.otelEndpoint = patch.otelEndpoint === null || patch.otelEndpoint === ''
      ? undefined
      : patch.otelEndpoint;
  }
  return next;
}

function pipelineShapeKey(policy: EffectiveDiagnosticsPolicy): string {
  return JSON.stringify({
    sinks: policy.sinks,
    redaction: policy.redaction.mode,
    logFilePath: policy.logFilePath ?? null,
    otelEndpoint: policy.otelEndpoint ?? null,
  });
}

export type DiagnosticsRuntimeCreateArgs = {
  environment: EnvironmentName;
  overrides?: Partial<RuntimeDiagnosticsPolicy>;
  escalations?: readonly EscalationRule[];
  clock?: Clock;
  shipped?: ShippedDebugCapabilities;
  sinkFactories?: SinkFactories;
};

export function diagnosticsRuntimeCreate(
  args: DiagnosticsRuntimeCreateArgs,
): DiagnosticsRuntime {
  const clock = args.clock ?? systemClock;
  const shipped = args.shipped ?? shippedDebugCapabilitiesGet();
  const sinkFactories = args.sinkFactories;

  let environment: EnvironmentName = args.environment;
  let preset: RuntimeDiagnosticsPolicy = environmentPresetPolicyClone(environment);
  let overrides: Partial<RuntimeDiagnosticsPolicy> = args.overrides
    ? { ...args.overrides }
    : {};
  let escalationStore: EscalationStore | undefined;

  let cachedPipelineKey: string | undefined;
  let cachedSink: DiagnosticsSink | undefined;
  let cachedRedaction: RedactionExecutor | undefined;

  function escalationsGet(): readonly EscalationRule[] {
    return escalationStore?.list() ?? [];
  }

  const configSnapshot = (): DiagnosticsConfig => ({
    environment,
    preset,
    overrides,
    escalations: escalationsGet(),
  });

  function effectivePolicyCompute(opts?: PolicyResolveOpts): EffectiveDiagnosticsPolicy {
    return effectivePolicyResolve({
      config: configSnapshot(),
      shipped,
      nowMs: clock.now(),
      opts,
    });
  }

  function sinkEnsure(policy: EffectiveDiagnosticsPolicy): DiagnosticsSink {
    const key = pipelineShapeKey(policy);
    if (cachedSink && cachedPipelineKey === key && cachedRedaction) {
      return cachedSink;
    }
    const redaction = cachedRedaction?.mode === policy.redaction.mode
      ? cachedRedaction
      : redactionPolicyCreate(policy.redaction.mode);
    const sink = sinkPipelineCreate({
      kinds: policy.sinks,
      redaction,
      logFilePath: policy.logFilePath,
      otelEndpoint: policy.otelEndpoint,
      factories: sinkFactories,
    });
    cachedPipelineKey = key;
    cachedSink = sink;
    cachedRedaction = redaction;
    return sink;
  }

  function auditDiagCreate(): Diagnostics {
    const policy = effectivePolicyCompute({ scope: AUDIT_SCOPE });
    return diagnosticsCreate({
      policy,
      sink: sinkEnsure(policy),
      scope: AUDIT_SCOPE,
      clock,
    });
  }

  escalationStore = escalationStoreCreate({
    clock,
    audit: {
      scope: AUDIT_SCOPE,
      child(sub) { return auditDiagCreate().child(sub); },
      enabled(lvl) { return auditDiagCreate().enabled(lvl); },
      error(name, fields) { auditDiagCreate().error(name, fields); },
      warn(name, fields) { auditDiagCreate().warn(name, fields); },
      info(name, fields) { auditDiagCreate().info(name, fields); },
      debug(name, fields) { auditDiagCreate().debug(name, fields); },
      trace(name, fields) { auditDiagCreate().trace(name, fields); },
      span(name, fields) { return auditDiagCreate().span(name, fields); },
    },
  });

  if (args.escalations && args.escalations.length > 0) {
    escalationStore.replace(args.escalations);
  }

  function getDiagnostics(
    scope: string,
    opts?: { requestId?: string; workspaceId?: string },
  ): Diagnostics {
    const policy = effectivePolicyCompute({
      scope,
      requestId: opts?.requestId,
      workspaceId: opts?.workspaceId,
    });
    return diagnosticsCreate({
      policy,
      sink: sinkEnsure(policy),
      scope,
      clock,
      requestId: opts?.requestId,
      workspaceId: opts?.workspaceId,
    });
  }

  function getContext(
    scope: string,
    opts?: ExecutionContextScopeOpts,
  ): ExecutionContext {
    const requestId = opts?.requestId ?? randomUUID();
    const workspaceId = opts?.workspaceId;
    const policy = effectivePolicyCompute({
      scope,
      requestId,
      workspaceId,
    });
    const diag = diagnosticsCreate({
      policy,
      sink: sinkEnsure(policy),
      scope,
      clock,
      requestId,
      workspaceId,
    });
    return {
      diag,
      clock,
      checks: checksFromPolicy(policy),
      requestId,
      workspaceId,
      abortSignal: opts?.abortSignal,
    };
  }

  function getEffectivePolicy(opts?: PolicyResolveOpts): EffectiveDiagnosticsPolicy {
    return effectivePolicyCompute(opts);
  }

  function setEnvironment(next: EnvironmentName): void {
    if (next === environment) return;
    auditDiagCreate().info('environment.changing', {
      previous: environment,
      next,
    });
    environment = next;
    preset = environmentPresetPolicyClone(environment);
    cachedPipelineKey = undefined;
    cachedSink = undefined;
    cachedRedaction = undefined;
    auditDiagCreate().info('environment.changed', { environment });
  }

  function setOverrides(patch: DiagnosticsOverridePatch): void {
    overrides = overridesPatchApply(overrides, patch);
    cachedPipelineKey = undefined;
    cachedSink = undefined;
    cachedRedaction = undefined;
  }

  function setConfig(patch: DiagnosticsConfigPatch): void {
    if (patch.environment) setEnvironment(patch.environment);
    if (patch.overrides) setOverrides(patch.overrides);
    if (patch.escalations) escalationStore!.replace(patch.escalations);
  }

  function escalate(input: EscalationRuleInput): EscalationHandle {
    return escalationStore!.add(input);
  }

  function revokeEscalation(id: string): boolean {
    return escalationStore!.revoke(id);
  }

  function listEscalations(): readonly EscalationRule[] {
    return escalationStore!.list();
  }

  return {
    getContext,
    getDiagnostics,
    getConfig: configSnapshot,
    getEffectivePolicy,
    setEnvironment,
    setOverrides,
    setConfig,
    escalate,
    revokeEscalation,
    listEscalations,
  };
}

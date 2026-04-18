/**
 * Convenience wrappers around the global `DiagnosticsRuntime`.
 *
 * Keep business code ignorant of the singleton: it should accept a
 * `Diagnostics` or `ExecutionContext` argument. These helpers are for
 * application-layer wiring (CLI, LSP, VSCode extension) and tests only.
 */
import type {
  Diagnostics,
  DiagnosticsConfig,
  DiagnosticsConfigPatch,
  DiagnosticsOverridePatch,
  EffectiveDiagnosticsPolicy,
  EnvironmentName,
  EscalationHandle,
  EscalationRule,
  EscalationRuleInput,
  ExecutionContext,
  ExecutionContextScopeOpts,
} from './diagnosticsTypes';
import { diagnosticsRuntimeGet } from './diagnosticsRuntimeGlobal';

export function diagnosticsGet(
  scope: string,
  opts?: { requestId?: string; workspaceId?: string },
): Diagnostics {
  return diagnosticsRuntimeGet().getDiagnostics(scope, opts);
}

export function executionContextCreate(
  scope: string,
  opts?: ExecutionContextScopeOpts,
): ExecutionContext {
  return diagnosticsRuntimeGet().getContext(scope, opts);
}

export function diagnosticsRuntimeGetConfig(): DiagnosticsConfig {
  return diagnosticsRuntimeGet().getConfig();
}

export function diagnosticsRuntimeGetEffectivePolicy(opts?: {
  scope?: string;
  requestId?: string;
  workspaceId?: string;
}): EffectiveDiagnosticsPolicy {
  return diagnosticsRuntimeGet().getEffectivePolicy(opts);
}

export function diagnosticsRuntimeSetEnvironment(
  environment: EnvironmentName,
): void {
  diagnosticsRuntimeGet().setEnvironment(environment);
}

export function diagnosticsRuntimeSetOverrides(
  patch: DiagnosticsOverridePatch,
): void {
  diagnosticsRuntimeGet().setOverrides(patch);
}

export function diagnosticsRuntimeSetConfig(
  patch: DiagnosticsConfigPatch,
): void {
  diagnosticsRuntimeGet().setConfig(patch);
}

export function diagnosticsRuntimeEscalate(
  rule: EscalationRuleInput,
): EscalationHandle {
  return diagnosticsRuntimeGet().escalate(rule);
}

export function diagnosticsRuntimeRevokeEscalation(id: string): boolean {
  return diagnosticsRuntimeGet().revokeEscalation(id);
}

export function diagnosticsRuntimeListEscalations(): readonly EscalationRule[] {
  return diagnosticsRuntimeGet().listEscalations();
}

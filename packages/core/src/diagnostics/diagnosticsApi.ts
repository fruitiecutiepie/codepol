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
  DiagnosticsPolicy,
  ExecutionContext,
  LogLevel,
} from './diagnosticsTypes';
import { diagnosticsRuntimeGet } from './diagnosticsRuntimeGlobal';

export function diagnosticsGet(scope: string): Diagnostics {
  return diagnosticsRuntimeGet().getDiagnostics(scope);
}

export function executionContextCreate(
  scope: string,
  opts?: { requestId?: string; abortSignal?: AbortSignal },
): ExecutionContext {
  return diagnosticsRuntimeGet().getContext(scope, opts);
}

export function diagnosticsRuntimeGetConfig(): DiagnosticsConfig {
  return diagnosticsRuntimeGet().getConfig();
}

export function diagnosticsRuntimeSetLevel(level: LogLevel): void {
  diagnosticsRuntimeGet().setLevel(level);
}

export function diagnosticsRuntimeSetScopeLevel(
  scope: string,
  level: LogLevel | undefined,
): void {
  diagnosticsRuntimeGet().setScopeLevel(scope, level);
}

export function diagnosticsRuntimeSetPolicy(
  patch: Partial<DiagnosticsPolicy>,
): void {
  diagnosticsRuntimeGet().setPolicy(patch);
}

export function diagnosticsRuntimeSetSink(patch: {
  consoleEnabled?: boolean;
  logFilePath?: string | null;
}): void {
  diagnosticsRuntimeGet().setSink(patch);
}

export function diagnosticsRuntimeSetConfig(
  patch: DiagnosticsConfigPatch,
): void {
  diagnosticsRuntimeGet().setConfig(patch);
}

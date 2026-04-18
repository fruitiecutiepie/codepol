/**
 * No-op `Diagnostics` / `ExecutionContext` for call sites that have no
 * runtime-provided context (tests, legacy callers). Using these keeps business
 * functions free of null checks while still costing nothing when unused.
 */
import type { Diagnostics, ExecutionContext, Span } from './diagnosticsTypes';
import { systemClock } from './diagnosticsCreate';

const noopSpan: Span = {
  end() { /* no-op */ },
};

export function diagnosticsNoopCreate(scope = ''): Diagnostics {
  const diag: Diagnostics = {
    scope,
    child(childScope) {
      return diagnosticsNoopCreate(
        scope.length === 0 ? childScope : `${scope}.${childScope}`,
      );
    },
    enabled() { return false; },
    error() { /* no-op */ },
    warn() { /* no-op */ },
    info() { /* no-op */ },
    debug() { /* no-op */ },
    trace() { /* no-op */ },
    span() { return noopSpan; },
  };
  return diag;
}

export function executionContextNoopCreate(scope = ''): ExecutionContext {
  return {
    diag: diagnosticsNoopCreate(scope),
    clock: systemClock,
    checks: {},
    requestId: 'noop',
  };
}

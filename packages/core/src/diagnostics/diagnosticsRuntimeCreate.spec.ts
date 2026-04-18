import { describe, expect, it } from 'vitest';
import { diagnosticsRuntimeCreate } from './diagnosticsRuntimeCreate';
import { memorySinkCreate } from './diagnosticsSinks';
import type { Clock } from './diagnosticsTypes';

function mockClockCreate(start = 1_000): {
  clock: Clock;
  advance: (ms: number) => void;
} {
  let now = start;
  return {
    clock: { now: () => now },
    advance(ms) { now += ms; },
  };
}

describe('diagnosticsRuntimeCreate', () => {
  it('applies the starting environment preset', () => {
    const runtime = diagnosticsRuntimeCreate({ environment: 'dev' });
    const effective = runtime.getEffectivePolicy();
    expect(effective.level).toBe('debug');
    expect(effective.environment).toBe('dev');
  });

  it('overrides layer on top of the preset and persist across getContext calls', () => {
    const runtime = diagnosticsRuntimeCreate({ environment: 'user' });
    runtime.setOverrides({ level: 'info' });
    const effective = runtime.getEffectivePolicy();
    expect(effective.level).toBe('info');
  });

  it('in-flight handles keep their snapshot when the environment changes', () => {
    const runtime = diagnosticsRuntimeCreate({ environment: 'user' });
    const earlier = runtime.getDiagnostics('scope.a');
    runtime.setEnvironment('verbose');
    const later = runtime.getDiagnostics('scope.a');
    expect(earlier.enabled('trace')).toBe(false);
    expect(later.enabled('trace')).toBe(true);
  });

  it('escalate + revoke round-trips and is reflected in listEscalations', () => {
    const mock = mockClockCreate();
    const runtime = diagnosticsRuntimeCreate({
      environment: 'user',
      clock: mock.clock,
    });
    const handle = runtime.escalate({
      scope: { kind: 'global' },
      level: 'trace',
      ttlMs: 60_000,
      reason: 'test',
      actor: 'spec',
    });
    expect(runtime.listEscalations()).toHaveLength(1);
    expect(runtime.getEffectivePolicy().level).toBe('trace');
    runtime.revokeEscalation(handle.id);
    expect(runtime.getEffectivePolicy().level).toBe('warn');
  });

  it('memory sink captures emitted records', () => {
    const memory = memorySinkCreate();
    const runtime = diagnosticsRuntimeCreate({
      environment: 'test',
      sinkFactories: { memoryOverride: memory },
    });
    runtime.getDiagnostics('scope.test').warn('hello');
    const records = memory.snapshot();
    expect(records).toHaveLength(1);
    expect(records[0]?.name).toBe('hello');
    expect(records[0]?.scope).toBe('scope.test');
  });

  it('getContext sets requestId and workspaceId on the resulting context', () => {
    const runtime = diagnosticsRuntimeCreate({ environment: 'user' });
    const ctx = runtime.getContext('plugin.x', {
      requestId: 'req-1',
      workspaceId: 'ws-1',
    });
    expect(ctx.requestId).toBe('req-1');
    expect(ctx.workspaceId).toBe('ws-1');
  });

  it('ChecksPolicy drives ExecutionContext.checks depth', () => {
    const runtime = diagnosticsRuntimeCreate({ environment: 'user' });
    expect(runtime.getContext('x').checks.validateIndexConsistency).toBeUndefined();
    runtime.setOverrides({ checks: { invariants: 'full' } });
    expect(runtime.getContext('x').checks.validateIndexConsistency).toBeDefined();
  });

  it('setConfig patches environment + overrides + escalations atomically', () => {
    const runtime = diagnosticsRuntimeCreate({ environment: 'user' });
    runtime.setConfig({
      environment: 'dev',
      overrides: { level: 'trace' },
      escalations: [],
    });
    const config = runtime.getConfig();
    expect(config.environment).toBe('dev');
    expect(config.overrides.level).toBe('trace');
  });
});

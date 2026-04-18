import { describe, expect, it } from 'vitest';
import type {
  DiagnosticsConfig,
  EscalationRule,
  ShippedDebugCapabilities,
} from './diagnosticsTypes';
import { effectivePolicyResolve } from './diagnosticsPolicyResolve';
import { environmentPresetPolicyClone } from './diagnosticsPresets';

function standardShipped(): ShippedDebugCapabilities {
  return {
    deepStateSnapshots: true,
    invariantChecks: true,
    traceSpans: true,
    profiling: true,
    faultInjection: true,
    adminInspectors: true,
    allowedSinks: ['console', 'file', 'memory', 'stdout', 'otel'],
    allowedMaxLevel: 'trace',
  };
}

function hardenedShipped(): ShippedDebugCapabilities {
  return {
    deepStateSnapshots: false,
    invariantChecks: false,
    traceSpans: true,
    profiling: false,
    faultInjection: false,
    adminInspectors: false,
    allowedSinks: ['stdout', 'otel'],
    allowedMaxLevel: 'info',
  };
}

function configFor(environment: DiagnosticsConfig['environment']): DiagnosticsConfig {
  return {
    environment,
    preset: environmentPresetPolicyClone(environment),
    overrides: {},
    escalations: [],
  };
}

describe('effectivePolicyResolve', () => {
  it('returns the preset untouched when no overrides or escalations apply', () => {
    const resolved = effectivePolicyResolve({
      config: configFor('dev'),
      shipped: standardShipped(),
      nowMs: 0,
    });
    expect(resolved.level).toBe('debug');
    expect(resolved.sinks).toEqual(['console', 'file']);
    expect(resolved.environment).toBe('dev');
  });

  it('applies overrides on top of the preset', () => {
    const config = {
      ...configFor('user'),
      overrides: {
        level: 'info',
        sinks: ['console', 'file'] as const,
        logFilePath: '/tmp/x.log',
      },
    } as DiagnosticsConfig;
    const resolved = effectivePolicyResolve({
      config,
      shipped: standardShipped(),
      nowMs: 0,
    });
    expect(resolved.level).toBe('info');
    expect(resolved.sinks).toEqual(['console', 'file']);
    expect(resolved.logFilePath).toBe('/tmp/x.log');
  });

  it('honors a global escalation within its TTL only', () => {
    const escalation: EscalationRule = {
      id: 'e1',
      scope: { kind: 'global' },
      level: 'trace',
      expiresAtUnixMs: 1_000,
      reason: 'investigation',
      actor: 'test',
    };
    const config = { ...configFor('user'), escalations: [escalation] };
    const active = effectivePolicyResolve({
      config,
      shipped: standardShipped(),
      nowMs: 500,
    });
    const expired = effectivePolicyResolve({
      config,
      shipped: standardShipped(),
      nowMs: 2_000,
    });
    expect(active.level).toBe('trace');
    expect(active.activeEscalations).toHaveLength(1);
    expect(expired.level).toBe('warn');
    expect(expired.activeEscalations).toHaveLength(0);
  });

  it('only activates scope-targeted escalation when the scope matches', () => {
    const escalation: EscalationRule = {
      id: 'e-scope',
      scope: { kind: 'scope', scope: 'parser' },
      level: 'trace',
      expiresAtUnixMs: 10_000,
      reason: 'abort',
      actor: 'test',
    };
    const config = { ...configFor('user'), escalations: [escalation] };
    const matched = effectivePolicyResolve({
      config,
      shipped: standardShipped(),
      nowMs: 1_000,
      opts: { scope: 'parser.adapterCore' },
    });
    const unmatched = effectivePolicyResolve({
      config,
      shipped: standardShipped(),
      nowMs: 1_000,
      opts: { scope: 'plugin.logger' },
    });
    expect(matched.level).toBe('trace');
    expect(matched.scopes.parser).toBe('trace');
    expect(unmatched.level).toBe('warn');
    expect(unmatched.activeEscalations).toHaveLength(0);
  });

  it('request-scoped escalation only fires when requestId matches', () => {
    const escalation: EscalationRule = {
      id: 'e-req',
      scope: { kind: 'request', requestId: 'req-1' },
      level: 'debug',
      expiresAtUnixMs: 10_000,
      reason: 'probe',
      actor: 'test',
    };
    const config = { ...configFor('user'), escalations: [escalation] };
    const matched = effectivePolicyResolve({
      config,
      shipped: standardShipped(),
      nowMs: 0,
      opts: { requestId: 'req-1' },
    });
    const unmatched = effectivePolicyResolve({
      config,
      shipped: standardShipped(),
      nowMs: 0,
      opts: { requestId: 'req-2' },
    });
    expect(matched.level).toBe('debug');
    expect(unmatched.level).toBe('warn');
  });

  it('hardened profile clamps level and drops disallowed sinks', () => {
    const config = {
      ...configFor('verbose'),
      overrides: {
        sinks: ['console', 'file', 'stdout'] as const,
      },
    } as DiagnosticsConfig;
    const resolved = effectivePolicyResolve({
      config,
      shipped: hardenedShipped(),
      nowMs: 0,
    });
    expect(resolved.level).toBe('info');
    expect(resolved.snapshots.enabled).toBe(false);
    expect(resolved.checks.invariants).toBe('off');
    expect(resolved.sinks).toEqual(['stdout']);
  });

  it('hardened profile disables tracing when traceSpans is not shipped', () => {
    const resolved = effectivePolicyResolve({
      config: configFor('verbose'),
      shipped: { ...hardenedShipped(), traceSpans: false },
      nowMs: 0,
    });
    expect(resolved.tracing.enabled).toBe(false);
    expect(resolved.tracing.sampleRate).toBe(0);
  });
});

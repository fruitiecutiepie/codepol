import { describe, expect, it, vi } from 'vitest';
import { diagnosticsCreate } from './diagnosticsCreate';
import { memorySinkCreate } from './diagnosticsSinks';
import type {
  Clock,
  EffectiveDiagnosticsPolicy,
  ShippedDebugCapabilities,
} from './diagnosticsTypes';

function shipped(): ShippedDebugCapabilities {
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

function policyFrom(overrides: {
  level: EffectiveDiagnosticsPolicy['level'];
  tracing?: EffectiveDiagnosticsPolicy['tracing'];
  scopes?: EffectiveDiagnosticsPolicy['scopes'];
}): EffectiveDiagnosticsPolicy {
  return {
    environment: 'dev',
    shipped: shipped(),
    activeEscalations: [],
    level: overrides.level,
    scopes: overrides.scopes ?? {},
    tracing: overrides.tracing ?? { enabled: false, sampleRate: 0 },
    metrics: { enabled: false },
    snapshots: { enabled: false, maxBytes: 0 },
    checks: { invariants: 'off' },
    redaction: { mode: 'off' },
    sinks: ['memory'],
  };
}

const fixedClock: Clock = { now: () => 1_000 };

describe('diagnosticsCreate', () => {
  it('gates events by level', () => {
    const sink = memorySinkCreate();
    const diag = diagnosticsCreate({
      policy: policyFrom({ level: 'warn' }),
      sink,
      scope: 'test',
      clock: fixedClock,
    });
    diag.info('dropped');
    diag.warn('kept');
    diag.error('also_kept');
    expect(sink.snapshot().map((r) => r.name)).toEqual(['kept', 'also_kept']);
  });

  it('does not call the lazy payload builder below threshold', () => {
    const sink = memorySinkCreate();
    const diag = diagnosticsCreate({
      policy: policyFrom({ level: 'warn' }),
      sink,
      scope: 'test',
      clock: fixedClock,
    });
    const builder = vi.fn(() => ({ heavy: true }));
    diag.debug('noisy', builder);
    expect(builder).not.toHaveBeenCalled();
  });

  it('applies dotted-scope overrides via the effective policy', () => {
    const sink = memorySinkCreate();
    const diag = diagnosticsCreate({
      policy: policyFrom({
        level: 'warn',
        scopes: { parser: 'trace' },
      }),
      sink,
      scope: 'parser.adapterCore',
      clock: fixedClock,
    });
    diag.trace('detail');
    expect(sink.snapshot()).toHaveLength(1);
  });

  it('span only emits when tracing is enabled + debug level is reached', () => {
    const offSink = memorySinkCreate();
    const off = diagnosticsCreate({
      policy: policyFrom({
        level: 'debug',
        tracing: { enabled: false, sampleRate: 1 },
      }),
      sink: offSink,
      scope: 'test',
      clock: fixedClock,
    });
    off.span('parse').end({ ok: true });
    expect(offSink.snapshot()).toHaveLength(0);

    const onSink = memorySinkCreate();
    let t = 0;
    const clock: Clock = { now: () => (t += 5) };
    const on = diagnosticsCreate({
      policy: policyFrom({
        level: 'debug',
        tracing: { enabled: true, sampleRate: 1 },
      }),
      sink: onSink,
      scope: 'test',
      clock,
      requestId: 'r',
    });
    on.span('parse', { file: 'a.ts' }).end({ ok: true });
    const names = onSink.snapshot().map((r) => r.name);
    expect(names).toEqual(['parse.begin', 'parse.end']);
  });

  it('span sampling is deterministic for a given scope+name+requestId', () => {
    const policy = policyFrom({
      level: 'debug',
      tracing: { enabled: true, sampleRate: 0.5 },
    });
    const sinkA = memorySinkCreate();
    const sinkB = memorySinkCreate();
    const diagA = diagnosticsCreate({
      policy, sink: sinkA, scope: 'svc', clock: fixedClock, requestId: 'r1',
    });
    const diagB = diagnosticsCreate({
      policy, sink: sinkB, scope: 'svc', clock: fixedClock, requestId: 'r1',
    });
    diagA.span('parse').end();
    diagB.span('parse').end();
    expect(sinkA.snapshot().length).toBe(sinkB.snapshot().length);
  });

  it('child scopes inherit the dotted path', () => {
    const sink = memorySinkCreate();
    const root = diagnosticsCreate({
      policy: policyFrom({ level: 'debug' }),
      sink,
      scope: 'plugin.logger',
      clock: fixedClock,
    });
    root.child('rule-1').debug('event');
    expect(sink.snapshot()[0]?.scope).toBe('plugin.logger.rule-1');
  });
});

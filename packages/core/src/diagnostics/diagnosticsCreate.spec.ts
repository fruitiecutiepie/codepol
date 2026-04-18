import { describe, expect, it, vi } from 'vitest';
import { diagnosticsCreate } from './diagnosticsCreate';
import { diagnosticsConfigDefaults } from './diagnosticsRuntimeCreate';
import type {
  DiagnosticsConfig,
  DiagnosticsRecord,
  DiagnosticsSink,
} from './diagnosticsTypes';

function recordingSinkCreate(): { sink: DiagnosticsSink; records: DiagnosticsRecord[] } {
  const records: DiagnosticsRecord[] = [];
  return {
    records,
    sink: { write: (r) => { records.push(r); } },
  };
}

function testConfigCreate(
  overrides: Partial<DiagnosticsConfig> = {},
): DiagnosticsConfig {
  const defaults = diagnosticsConfigDefaults();
  return {
    ...defaults,
    ...overrides,
    policy: { ...defaults.policy, ...(overrides.policy ?? {}) },
    sink: { ...defaults.sink, ...(overrides.sink ?? {}) },
    scopes: { ...defaults.scopes, ...(overrides.scopes ?? {}) },
  };
}

const clock = { now: () => 1000 };

describe('diagnosticsCreate', () => {
  it('gates events by level', () => {
    const { sink, records } = recordingSinkCreate();
    const diag = diagnosticsCreate({
      config: testConfigCreate({ level: 'warn' }),
      sink,
      scope: 'test',
      clock,
    });
    diag.info('should_be_dropped');
    diag.warn('should_appear');
    diag.error('should_also_appear');
    expect(records.map((r) => r.name)).toEqual([
      'should_appear',
      'should_also_appear',
    ]);
  });

  it('does not invoke lazy field builder when level is below threshold', () => {
    const { sink } = recordingSinkCreate();
    const diag = diagnosticsCreate({
      config: testConfigCreate({ level: 'warn' }),
      sink,
      scope: 'test',
      clock,
    });
    const builder = vi.fn(() => ({ heavy: true }));
    diag.debug('heavy', builder);
    expect(builder).not.toHaveBeenCalled();
  });

  it('invokes lazy field builder when debug is enabled', () => {
    const { sink, records } = recordingSinkCreate();
    const diag = diagnosticsCreate({
      config: testConfigCreate({ level: 'debug' }),
      sink,
      scope: 'test',
      clock,
    });
    const builder = vi.fn(() => ({ ok: 1 }));
    diag.debug('payload', builder);
    expect(builder).toHaveBeenCalledTimes(1);
    expect(records[0]?.fields).toEqual({ ok: 1 });
  });

  it('applies per-scope overrides via dotted-path inheritance', () => {
    const { sink, records } = recordingSinkCreate();
    const diag = diagnosticsCreate({
      config: testConfigCreate({
        level: 'warn',
        scopes: { parser: 'trace' },
      }),
      sink,
      scope: 'parser.adapterCore',
      clock,
    });
    diag.trace('detail', () => ({ ok: true }));
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('trace');
  });

  it('child scopes extend the dotted scope path', () => {
    const { sink, records } = recordingSinkCreate();
    const root = diagnosticsCreate({
      config: testConfigCreate({ level: 'debug' }),
      sink,
      scope: 'plugin.logger',
      clock,
    });
    const child = root.child('require-logger');
    child.debug('hello');
    expect(records[0]?.scope).toBe('plugin.logger.require-logger');
  });

  it('span.end emits timing only when includeTiming is set', () => {
    const { sink: offSink, records: offRecords } = recordingSinkCreate();
    const offDiag = diagnosticsCreate({
      config: testConfigCreate({
        level: 'debug',
        policy: { ...diagnosticsConfigDefaults().policy, includeTiming: false },
      }),
      sink: offSink,
      scope: 'test',
      clock,
    });
    offDiag.span('parse', { file: 'a.ts' }).end({ ok: true });
    expect(offRecords).toHaveLength(0);

    const { sink: onSink, records: onRecords } = recordingSinkCreate();
    let t = 0;
    const timedClock = { now: () => (t += 5) };
    const onDiag = diagnosticsCreate({
      config: testConfigCreate({
        level: 'debug',
        policy: { ...diagnosticsConfigDefaults().policy, includeTiming: true },
      }),
      sink: onSink,
      scope: 'test',
      clock: timedClock,
    });
    onDiag.span('parse', { file: 'a.ts' }).end({ ok: true });
    expect(onRecords.map((r) => r.name)).toEqual(['parse.begin', 'parse.end']);
    expect(onRecords[1]?.fields).toMatchObject({
      file: 'a.ts',
      ok: true,
      durationMs: 10,
    });
  });

  it('drops payload fields when includePayloads is false', () => {
    const { sink, records } = recordingSinkCreate();
    const diag = diagnosticsCreate({
      config: testConfigCreate({
        level: 'info',
        policy: { ...diagnosticsConfigDefaults().policy, includePayloads: false },
      }),
      sink,
      scope: 'test',
      clock,
    });
    diag.info('event', { secret: 'value' });
    expect(records[0]?.fields).toBeUndefined();
  });
});

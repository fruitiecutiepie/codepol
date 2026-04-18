import { describe, expect, it } from 'vitest';
import {
  ENV_PRESETS,
  environmentNameParse,
  environmentPresetPolicyClone,
} from './diagnosticsPresets';

describe('diagnosticsPresets', () => {
  it('user preset is safe by default', () => {
    const policy = ENV_PRESETS.user.diagnostics;
    expect(policy.level).toBe('warn');
    expect(policy.redaction.mode).toBe('strict');
    expect(policy.snapshots.enabled).toBe(false);
    expect(policy.checks.invariants).toBe('off');
    expect(policy.tracing.enabled).toBe(false);
    expect(policy.tracing.sampleRate).toBe(0);
    expect(policy.sinks).toEqual(['stdout']);
  });

  it('dev preset is productive-day posture', () => {
    const policy = ENV_PRESETS.dev.diagnostics;
    expect(policy.level).toBe('debug');
    expect(policy.redaction.mode).toBe('standard');
    expect(policy.snapshots.enabled).toBe(true);
    expect(policy.snapshots.maxBytes).toBeGreaterThan(0);
    expect(policy.checks.invariants).toBe('cheap');
    expect(policy.tracing.enabled).toBe(true);
    expect(policy.tracing.sampleRate).toBeLessThan(1);
    expect(policy.sinks).toEqual(['console', 'file']);
  });

  it('test preset is deterministic', () => {
    const policy = ENV_PRESETS.test.diagnostics;
    expect(policy.level).toBe('warn');
    expect(policy.redaction.mode).toBe('off');
    expect(policy.tracing.enabled).toBe(false);
    expect(policy.checks.invariants).toBe('cheap');
    expect(policy.sinks).toEqual(['memory']);
  });

  it('verbose preset is the only loud preset', () => {
    const policy = ENV_PRESETS.verbose.diagnostics;
    expect(policy.level).toBe('trace');
    expect(policy.snapshots.enabled).toBe(true);
    expect(policy.checks.invariants).toBe('full');
    expect(policy.tracing.enabled).toBe(true);
    expect(policy.tracing.sampleRate).toBe(1);
  });

  it('every preset explicitly sets checks.invariants', () => {
    for (const preset of Object.values(ENV_PRESETS)) {
      expect(['off', 'cheap', 'full']).toContain(preset.diagnostics.checks.invariants);
    }
  });

  it('environmentPresetPolicyClone returns a deep-ish copy', () => {
    const clone = environmentPresetPolicyClone('user');
    clone.sinks = ['file'];
    expect(ENV_PRESETS.user.diagnostics.sinks).toEqual(['stdout']);
  });

  it('environmentNameParse rejects unknown names', () => {
    expect(environmentNameParse('prod')).toBeUndefined();
    expect(environmentNameParse(undefined)).toBeUndefined();
    expect(environmentNameParse('VERBOSE')).toBe('verbose');
    expect(environmentNameParse('user')).toBe('user');
  });
});

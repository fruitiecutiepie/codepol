import { describe, expect, it } from 'vitest';
import { redactionPolicyCreate } from './diagnosticsRedaction';

describe('redactionPolicyCreate', () => {
  it('off mode is passthrough', () => {
    const executor = redactionPolicyCreate('off');
    const fields = { token: 'abc', nested: { secret: 'x' } };
    expect(executor.redactFields(fields)).toBe(fields);
  });

  it('standard mode redacts token/secret/password/apiKey fields', () => {
    const executor = redactionPolicyCreate('standard');
    const redacted = executor.redactFields({
      authToken: 'xyz',
      password: 'hunter2',
      apiKey: 'key',
      okField: 1,
      nested: { sessionId: 'abc' },
    });
    expect(redacted).toMatchObject({
      authToken: '[redacted]',
      password: '[redacted]',
      apiKey: '[redacted]',
      okField: 1,
      nested: { sessionId: '[redacted]' },
    });
  });

  it('strict mode also redacts source-like fields', () => {
    const executor = redactionPolicyCreate('strict');
    const redacted = executor.redactFields({
      filePath: '/repo/src/a.ts',
      sourcePreview: 'const x = 1',
      source: 'const x = 1',
      errorStack: 'Error: boom\n at line 1',
      safeField: 'ok',
    });
    expect(redacted).toMatchObject({
      filePath: '/repo/src/a.ts',
      sourcePreview: '[redacted]',
      source: '[redacted]',
      errorStack: '[redacted]',
      safeField: 'ok',
    });
  });

  it('strict mode truncates very long string values', () => {
    const executor = redactionPolicyCreate('strict');
    const bigString = 'x'.repeat(10_000);
    const redacted = executor.redactFields({ note: bigString }) as Record<string, unknown>;
    expect(typeof redacted.note).toBe('string');
    expect((redacted.note as string).length).toBeLessThan(bigString.length);
    expect((redacted.note as string).endsWith('<truncated>')).toBe(true);
  });

  it('redactRecord returns a new record without mutating input', () => {
    const executor = redactionPolicyCreate('standard');
    const record = {
      scope: 'test',
      level: 'info' as const,
      name: 'event',
      fields: { secret: 'v' },
      timestampMs: 0,
    };
    const next = executor.redactRecord(record);
    expect(next.fields).not.toBe(record.fields);
    expect(next.fields).toMatchObject({ secret: '[redacted]' });
    expect(record.fields.secret).toBe('v');
  });
});

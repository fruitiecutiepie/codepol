import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import schema from '../policy.schema.json';
import policy from '../policy.json';

describe('policy contract', () => {
  it('policy.json matches schema', () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const ok = validate(policy);
    if (!ok) {
      throw new Error(JSON.stringify(validate.errors, null, 2));
    }
  });

  it('rule ids are unique', () => {
    const ids = policy.rules.map(rule => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each rule defines at least one target glob', () => {
    for (const rule of policy.rules) {
      expect(Array.isArray(rule.targets)).toBe(true);
      expect(rule.targets.length).toBeGreaterThan(0);
      for (const target of rule.targets) {
        expect(Array.isArray(target.files)).toBe(true);
        expect(target.files.length).toBeGreaterThan(0);
      }
    }
  });
});

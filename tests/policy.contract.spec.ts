import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import schema from '../policy.schema.json';
import policy from '../policy.json';
import { policyRuleTargetsResolve, type PolicyFile } from '@codepol/core';

describe('policy contract', () => {
  it('policy.json matches schema', () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const ok = validate(policy);
    if (!ok) {
      throw new Error(JSON.stringify(validate.errors, null, 2));
    }
  });

  it('rule identifiers are unique', () => {
    // Check that resolved IDs (id or ruleId fallback) are unique within the policy
    const ids = policy.rules.map(rule => rule.id ?? rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each rule defines at least one target glob', () => {
    const policyTyped = policy as PolicyFile;
    for (const rule of policyTyped.rules) {
      const targets = policyRuleTargetsResolve(rule, policyTyped);
      expect(Array.isArray(targets)).toBe(true);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(Array.isArray(target.files)).toBe(true);
        expect(target.files.length).toBeGreaterThan(0);
      }
    }
  });
});

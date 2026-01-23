import { describe, expect, it } from 'vitest';
import config from '../codepol.config';
import { policyRuleTargetsResolve } from '@codepol/core';

describe('policy contract', () => {
  it('rule identifiers are unique', () => {
    // Check that resolved IDs (id or ruleId fallback) are unique within the policy
    const ids = config.rules.map(rule => rule.id ?? rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each rule defines at least one target glob', () => {
    for (const rule of config.rules) {
      const targets = policyRuleTargetsResolve(rule, config);
      expect(Array.isArray(targets)).toBe(true);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(Array.isArray(target.files)).toBe(true);
        expect(target.files.length).toBeGreaterThan(0);
      }
    }
  });
});

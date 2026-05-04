import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { configGetFromPathSync, isOk, policyRuleTargetsResolve } from '@codepol/core';

const configR = configGetFromPathSync(path.resolve(__dirname, '..', 'codepol.toml'));
if (!isOk(configR)) {
  throw new Error(configR.Err.message);
}
const { config } = configR.Ok;

describe('policy contract', () => {
  it('rule identifiers are unique', () => {
    // Check that resolved IDs (id or ruleId fallback) are unique within the policy
    const ids = config.rules.map(rule => rule.id ?? rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each rule defines at least one target glob', () => {
    for (const rule of config.rules) {
      const targetsR = policyRuleTargetsResolve(rule, config);
      expect(isOk(targetsR)).toBe(true);
      if (!isOk(targetsR)) return;
      const targets = targetsR.Ok;
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(Array.isArray(target.files)).toBe(true);
        expect(target.files.length).toBeGreaterThan(0);
      }
    }
  });
});

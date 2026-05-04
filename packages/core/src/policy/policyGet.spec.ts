import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  policyRuleTargetsResolve,
  globPatternsGetMatchAny,
  ruleTargetMatchesLanguage,
  policyFileGetChecked,
  ruleMatchesGet,
} from './policyGet';
import { isErr, isOk } from '../result/result';
import type { PolicyFile, PolicyRule, PolicyRuleTarget } from './policyTypes';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ============================================================================
// Helpers
// ============================================================================

function policyRuleTargetNew(overrides: Partial<PolicyRuleTarget> & { language: string; files: string[] }): PolicyRuleTarget {
  return { ...overrides };
}

function policyRuleNew(overrides: Partial<PolicyRule> & { ruleId: string; targets: string[] }): PolicyRule {
  return { ...overrides };
}

function policyFileNew(overrides: Partial<PolicyFile> & { targets: PolicyFile['targets']; rules: PolicyFile['rules'] }): PolicyFile {
  return { ...overrides };
}

// ============================================================================
// Tests
// ============================================================================

describe('policyGet', () => {
  describe('policyRuleTargetsResolve', () => {
    it('resolves targets from the policy target map', () => {
      const tsTarget = policyRuleTargetNew({ language: 'typescript', files: ['src/**/*.ts'] });
      const tsxTarget = policyRuleTargetNew({ language: 'tsx', files: ['src/**/*.tsx'] });
      const policy = policyFileNew({
        targets: { ts: tsTarget, tsx: tsxTarget },
        rules: [],
      });
      const rule = policyRuleNew({ ruleId: 'my-rule', targets: ['ts', 'tsx'] });

      const resolvedR = policyRuleTargetsResolve(rule, policy);
      expect(isOk(resolvedR)).toBe(true);
      if (!isOk(resolvedR)) return;
      const resolved = resolvedR.Ok;
      expect(resolved).toHaveLength(2);
      expect(resolved[0]).toBe(tsTarget);
      expect(resolved[1]).toBe(tsxTarget);
    });

    it('returns Err when a target reference is missing', () => {
      const policy = policyFileNew({
        targets: { ts: policyRuleTargetNew({ language: 'typescript', files: ['src/**/*.ts'] }) },
        rules: [],
      });
      const rule = policyRuleNew({ ruleId: 'bad-rule', targets: ['nonexistent'] });

      const r = policyRuleTargetsResolve(rule, policy);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.Err.message).toContain(
          'Rule "bad-rule" references target "nonexistent" which is not defined in policy.targets',
        );
      }
    });
  });

  describe('globPatternsGetMatchAny', () => {
    it('returns true when a pattern matches the file path', () => {
      expect(globPatternsGetMatchAny(['src/**/*.ts'], 'src/utils/foo.ts')).toBe(true);
      expect(globPatternsGetMatchAny(['**/*.tsx'], 'src/components/App.tsx')).toBe(true);
    });

    it('returns false when no pattern matches', () => {
      expect(globPatternsGetMatchAny(['src/**/*.ts'], 'lib/bar.js')).toBe(false);
    });

    it('returns false for undefined or empty patterns', () => {
      expect(globPatternsGetMatchAny(undefined, 'src/foo.ts')).toBe(false);
      expect(globPatternsGetMatchAny([], 'src/foo.ts')).toBe(false);
    });

    it('matches dot-files with dot: true', () => {
      expect(globPatternsGetMatchAny(['**/*.ts'], '.hidden/config.ts')).toBe(true);
    });
  });

  describe('ruleTargetMatchesLanguage', () => {
    it('typescript matches .ts and .tsx files', () => {
      const target = policyRuleTargetNew({ language: 'typescript', files: [] });
      expect(ruleTargetMatchesLanguage(target, 'src/foo.ts')).toBe(true);
      expect(ruleTargetMatchesLanguage(target, 'src/App.tsx')).toBe(true);
    });

    it('tsx matches only .tsx files', () => {
      const target = policyRuleTargetNew({ language: 'tsx', files: [] });
      expect(ruleTargetMatchesLanguage(target, 'src/App.tsx')).toBe(true);
      expect(ruleTargetMatchesLanguage(target, 'src/foo.ts')).toBe(false);
    });

    it('other language values match any file', () => {
      const target = policyRuleTargetNew({ language: 'python', files: [] });
      expect(ruleTargetMatchesLanguage(target, 'src/foo.py')).toBe(true);
      expect(ruleTargetMatchesLanguage(target, 'src/foo.ts')).toBe(true);
    });
  });

  describe('policyFileGetChecked', () => {
    const tsTarget = policyRuleTargetNew({ language: 'typescript', files: ['src/**/*.ts'] });
    const policy = policyFileNew({
      targets: { ts: tsTarget },
      rules: [policyRuleNew({ ruleId: 'my-rule', targets: ['ts'] })],
    });
    const cwd = '/project';

    it('returns true for a file matching a rule target', () => {
      const r = policyFileGetChecked(policy, '/project/src/utils/foo.ts', cwd);
      expect(isOk(r) && r.Ok).toBe(true);
    });

    it('returns false for a file not matching any target', () => {
      const r = policyFileGetChecked(policy, '/project/lib/bar.js', cwd);
      expect(isOk(r) && !r.Ok).toBe(true);
    });

    it('returns false for a file excluded by global exclude', () => {
      const policyWithExclude = policyFileNew({
        targets: { ts: tsTarget },
        rules: [policyRuleNew({ ruleId: 'my-rule', targets: ['ts'] })],
        exclude: ['src/utils/**'],
      });
      const r = policyFileGetChecked(policyWithExclude, '/project/src/utils/foo.ts', cwd);
      expect(isOk(r) && !r.Ok).toBe(true);
    });

    it('returns false for a file excluded by target exclude', () => {
      const tsTargetWithExclude = policyRuleTargetNew({
        language: 'typescript',
        files: ['src/**/*.ts'],
        exclude: ['src/generated/**'],
      });
      const policyTargetExclude = policyFileNew({
        targets: { ts: tsTargetWithExclude },
        rules: [policyRuleNew({ ruleId: 'my-rule', targets: ['ts'] })],
      });
      const r = policyFileGetChecked(policyTargetExclude, '/project/src/generated/types.ts', cwd);
      expect(isOk(r) && !r.Ok).toBe(true);
    });

    it('returns false when file matches target glob but not the language', () => {
      const tsxOnlyTarget = policyRuleTargetNew({
        language: 'tsx',
        files: ['src/**/*.ts', 'src/**/*.tsx'],
      });
      const policyTsx = policyFileNew({
        targets: { tsx: tsxOnlyTarget },
        rules: [policyRuleNew({ ruleId: 'tsx-rule', targets: ['tsx'] })],
      });
      // .ts file does not match tsx-only language
      const rTs = policyFileGetChecked(policyTsx, '/project/src/foo.ts', cwd);
      expect(isOk(rTs) && !rTs.Ok).toBe(true);
      // .tsx file does match
      const rTsx = policyFileGetChecked(policyTsx, '/project/src/App.tsx', cwd);
      expect(isOk(rTsx) && rTsx.Ok).toBe(true);
    });
  });

  describe('ruleMatchesGet', () => {
    let testDir: string;

    beforeAll(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-test-policy-'));
      // Create directory structure: src/utils/, src/components/
      fs.mkdirSync(path.join(testDir, 'src', 'utils'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'src', 'components'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'src', 'generated'), { recursive: true });
      // Create files
      fs.writeFileSync(path.join(testDir, 'src', 'utils', 'helpers.ts'), 'export const x = 1;');
      fs.writeFileSync(path.join(testDir, 'src', 'utils', 'format.ts'), 'export const y = 2;');
      fs.writeFileSync(path.join(testDir, 'src', 'components', 'App.tsx'), 'export const App = () => null;');
      fs.writeFileSync(path.join(testDir, 'src', 'generated', 'types.ts'), 'export type Foo = string;');
    });

    afterAll(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('returns matched files for each rule target', async () => {
      const policy = policyFileNew({
        targets: {
          ts: policyRuleTargetNew({ language: 'typescript', files: ['src/**/*.ts'] }),
        },
        rules: [policyRuleNew({ ruleId: 'rule-a', targets: ['ts'] })],
      });

      const matchesR = await ruleMatchesGet(policy, testDir);
      expect(isOk(matchesR)).toBe(true);
      if (!isOk(matchesR)) return;
      const matches = matchesR.Ok;
      expect(matches).toHaveLength(1);
      expect(matches[0].rule.ruleId).toBe('rule-a');
      // Should find the 3 .ts files (helpers.ts, format.ts, types.ts)
      expect(matches[0].files).toHaveLength(3);
      const basenames = matches[0].files.map(f => path.basename(f)).sort();
      expect(basenames).toEqual(['format.ts', 'helpers.ts', 'types.ts']);
    });

    it('filters files by global exclude patterns', async () => {
      const policy = policyFileNew({
        targets: {
          ts: policyRuleTargetNew({ language: 'typescript', files: ['src/**/*.ts'] }),
        },
        rules: [policyRuleNew({ ruleId: 'rule-b', targets: ['ts'] })],
        exclude: ['src/generated/**'],
      });

      const matchesR = await ruleMatchesGet(policy, testDir);
      expect(isOk(matchesR)).toBe(true);
      if (!isOk(matchesR)) return;
      const matches = matchesR.Ok;
      expect(matches).toHaveLength(1);
      const basenames = matches[0].files.map(f => path.basename(f)).sort();
      expect(basenames).toEqual(['format.ts', 'helpers.ts']);
    });

    it('filters files by target exclude patterns', async () => {
      const policy = policyFileNew({
        targets: {
          ts: policyRuleTargetNew({
            language: 'typescript',
            files: ['src/**/*.ts'],
            exclude: ['src/utils/**'],
          }),
        },
        rules: [policyRuleNew({ ruleId: 'rule-c', targets: ['ts'] })],
      });

      const matchesR = await ruleMatchesGet(policy, testDir);
      expect(isOk(matchesR)).toBe(true);
      if (!isOk(matchesR)) return;
      const matches = matchesR.Ok;
      expect(matches).toHaveLength(1);
      const basenames = matches[0].files.map(f => path.basename(f)).sort();
      expect(basenames).toEqual(['types.ts']);
    });

    it('filters files by language (tsx target excludes .ts files)', async () => {
      const policy = policyFileNew({
        targets: {
          tsx: policyRuleTargetNew({
            language: 'tsx',
            files: ['src/**/*.ts', 'src/**/*.tsx'],
          }),
        },
        rules: [policyRuleNew({ ruleId: 'tsx-rule', targets: ['tsx'] })],
      });

      const matchesR = await ruleMatchesGet(policy, testDir);
      expect(isOk(matchesR)).toBe(true);
      if (!isOk(matchesR)) return;
      const matches = matchesR.Ok;
      expect(matches).toHaveLength(1);
      // Only .tsx files should remain after language filtering
      expect(matches[0].files).toHaveLength(1);
      expect(path.basename(matches[0].files[0])).toBe('App.tsx');
    });

    it('returns multiple matches when a rule has multiple targets', async () => {
      const policy = policyFileNew({
        targets: {
          ts: policyRuleTargetNew({ language: 'typescript', files: ['src/**/*.ts'] }),
          tsx: policyRuleTargetNew({ language: 'tsx', files: ['src/**/*.tsx'] }),
        },
        rules: [policyRuleNew({ ruleId: 'multi-target', targets: ['ts', 'tsx'] })],
      });

      const matchesR = await ruleMatchesGet(policy, testDir);
      expect(isOk(matchesR)).toBe(true);
      if (!isOk(matchesR)) return;
      const matches = matchesR.Ok;
      // One match per target
      expect(matches).toHaveLength(2);
      expect(matches[0].target.language).toBe('typescript');
      expect(matches[1].target.language).toBe('tsx');
      expect(matches[1].files).toHaveLength(1);
    });
  });

  // ============================================================================
  // Policy contract validation
  // ============================================================================

  describe('policy contract validation', () => {
    it('rejects unknown rule target references (partially valid targets list)', () => {
      const policy = policyFileNew({
        targets: {
          ts: policyRuleTargetNew({ language: 'typescript', files: ['src/**/*.ts'] }),
        },
        rules: [],
      });
      // Rule references two targets: 'ts' exists, 'nonexistent' does not.
      // policyRuleTargetsResolve iterates in order and should throw on the bad one.
      const rule = policyRuleNew({ ruleId: 'mixed-rule', targets: ['ts', 'nonexistent'] });

      const r = policyRuleTargetsResolve(rule, policy);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.Err.message).toContain(
          'Rule "mixed-rule" references target "nonexistent" which is not defined in policy.targets',
        );
      }
    });

    it('returns Err for empty targets map when a rule references any target', () => {
      const policy = policyFileNew({
        targets: {},
        rules: [],
      });
      const rule = policyRuleNew({ ruleId: 'orphan-rule', targets: ['missing'] });

      const r = policyRuleTargetsResolve(rule, policy);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.Err.message).toContain(
          'Rule "orphan-rule" references target "missing" which is not defined in policy.targets',
        );
      }
    });

    it('handles a rule with empty targets array (no-op)', () => {
      const policy = policyFileNew({
        targets: {
          ts: policyRuleTargetNew({ language: 'typescript', files: ['src/**/*.ts'] }),
        },
        rules: [],
      });
      // Rule with no target references — policyRuleTargetsResolve should return []
      const rule = policyRuleNew({ ruleId: 'no-targets-rule', targets: [] });

      const resolvedR = policyRuleTargetsResolve(rule, policy);
      expect(isOk(resolvedR)).toBe(true);
      if (isOk(resolvedR)) {
        expect(resolvedR.Ok).toEqual([]);
      }
    });
  });
});

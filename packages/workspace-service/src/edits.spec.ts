import { describe, expect, it } from 'vitest';
import type { PolicyViolation } from '@codepol/core';
import {
  fileWorkspaceEditsNormalize,
  fixAllContributionFromViolation,
  workspaceEditPlanCreateFromFix,
  workspaceFixAllActionCreate,
} from './edits';

describe('workspace edit helpers', () => {
  it('deduplicates identical edits', () => {
    const result = fileWorkspaceEditsNormalize([
      {
        filePath: '/workspace/app.ts',
        byteRange: { start: 0, end: 3 },
        text: 'foo',
      },
      {
        filePath: '/workspace/app.ts',
        byteRange: { start: 0, end: 3 },
        text: 'foo',
      },
    ]);

    expect('Ok' in result && result.Ok).toEqual([
      {
        filePath: '/workspace/app.ts',
        byteRange: { start: 0, end: 3 },
        text: 'foo',
      },
    ]);
  });

  it('rejects overlapping edits when building an edit plan', () => {
    const result = workspaceEditPlanCreateFromFix({
      filePath: '/workspace/app.ts',
      title: 'Apply fix',
      diagnostic: {
        id: 'diag-1',
        uri: 'file:///workspace/app.ts',
        source: 'codepol',
        code: 'rule',
        severity: 'error',
        message: 'problem',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
      fix: {
        byteRange: { start: 0, end: 4 },
        text: 'foo',
        edits: [
          {
            filePath: '/workspace/app.ts',
            byteRange: { start: 0, end: 4 },
            text: 'foo',
          },
          {
            filePath: '/workspace/app.ts',
            byteRange: { start: 2, end: 5 },
            text: 'bar',
          },
        ],
      },
      sourceGet: () => 'abcdef',
    });

    expect('Err' in result ? result.Err : '').toContain('Overlapping edits detected');
  });

  it('merges non-overlapping fix-all contributions into one plan', () => {
    const violationA: PolicyViolation = {
      ruleId: '@codepol/plugin/rule-a',
      filePath: '/workspace/app.ts',
      message: 'A',
      line: 1,
      column: 1,
      fix: {
        byteRange: { start: 0, end: 3 },
        text: 'foo',
      },
    };
    const violationB: PolicyViolation = {
      ruleId: '@codepol/plugin/rule-b',
      filePath: '/workspace/app.ts',
      message: 'B',
      line: 1,
      column: 4,
      fix: {
        byteRange: { start: 5, end: 8 },
        text: 'bar',
      },
    };

    const contributionA = fixAllContributionFromViolation(violationA, 'diag-a');
    const contributionB = fixAllContributionFromViolation(violationB, 'diag-b');
    if (!contributionA || !contributionB) {
      throw new Error('expected contributions');
    }

    const result = workspaceFixAllActionCreate({
      title: 'Fix all Codepol auto-fixable problems',
      kind: 'source.fixAll',
      contributions: [contributionA, contributionB],
      sourceGet: () => 'abc,defgh',
    });

    if (!('Ok' in result) || !result.Ok) {
      throw new Error('expected Ok');
    }
    const action = result.Ok;
    expect(action.kind).toBe('source.fixAll');
    expect(action.plan.kind).toBe('source.fixAll');
    expect(action.plan.edits).toHaveLength(2);
    expect(action.diagnosticIds.sort()).toEqual(['diag-a', 'diag-b']);
    expect(action.conflicts).toBeUndefined();
  });

  it('drops the later contribution on overlap and records a conflict', () => {
    const firstViolation: PolicyViolation = {
      ruleId: '@codepol/plugin/rule-first',
      filePath: '/workspace/app.ts',
      message: 'first',
      line: 1,
      column: 1,
      fix: {
        byteRange: { start: 0, end: 4 },
        text: 'AAAA',
      },
    };
    const overlappingViolation: PolicyViolation = {
      ruleId: '@codepol/plugin/rule-second',
      filePath: '/workspace/app.ts',
      message: 'second',
      line: 1,
      column: 3,
      fix: {
        byteRange: { start: 2, end: 6 },
        text: 'BBBB',
      },
    };

    const first = fixAllContributionFromViolation(firstViolation, 'diag-1');
    const second = fixAllContributionFromViolation(overlappingViolation, 'diag-2');
    if (!first || !second) {
      throw new Error('expected contributions');
    }

    const result = workspaceFixAllActionCreate({
      title: 'Fix all',
      kind: 'source.fixAll',
      contributions: [first, second],
      sourceGet: () => 'xxxxxxxx',
    });

    if (!('Ok' in result) || !result.Ok) {
      throw new Error('expected Ok');
    }
    const action = result.Ok;
    expect(action.plan.edits).toHaveLength(1);
    expect(action.diagnosticIds).toEqual(['diag-1']);
    expect(action.conflicts).toBeDefined();
    expect(action.conflicts?.[0]?.droppedRuleId).toBe('@codepol/plugin/rule-second');
  });

  it('returns null when every contribution is empty', () => {
    const result = workspaceFixAllActionCreate({
      title: 'Fix all',
      kind: 'source.fixAll',
      contributions: [],
      sourceGet: () => '',
    });
    if (!('Ok' in result)) {
      throw new Error('expected Ok');
    }
    expect(result.Ok).toBeNull();
  });

  it('sets ruleId for a per-rule fix-all action', () => {
    const violation: PolicyViolation = {
      ruleId: '@codepol/plugin/rule-a',
      filePath: '/workspace/app.ts',
      message: 'A',
      line: 1,
      column: 1,
      fix: {
        byteRange: { start: 0, end: 2 },
        text: 'zz',
      },
    };
    const contribution = fixAllContributionFromViolation(violation, 'diag-a');
    if (!contribution) {
      throw new Error('expected contribution');
    }

    const result = workspaceFixAllActionCreate({
      title: 'Fix all @codepol/plugin/rule-a',
      kind: 'source.fixAll.rule',
      ruleId: '@codepol/plugin/rule-a',
      contributions: [contribution],
      sourceGet: () => 'ab',
    });

    if (!('Ok' in result) || !result.Ok) {
      throw new Error('expected Ok');
    }
    expect(result.Ok.kind).toBe('source.fixAll.rule');
    expect(result.Ok.ruleId).toBe('@codepol/plugin/rule-a');
  });

  it('groups multi-file fix.edits by file path when building an edit plan', () => {
    const result = workspaceEditPlanCreateFromFix({
      filePath: '/workspace/app.ts',
      title: 'Apply fix',
      diagnostic: {
        id: 'diag-1',
        uri: 'file:///workspace/app.ts',
        source: 'codepol',
        code: 'rule',
        severity: 'error',
        message: 'problem',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
      fix: {
        byteRange: { start: 0, end: 1 },
        text: 'x',
        edits: [
          {
            filePath: '/workspace/app.ts',
            byteRange: { start: 0, end: 1 },
            text: 'a',
          },
          {
            filePath: '/workspace/other.ts',
            byteRange: { start: 0, end: 1 },
            text: 'b',
          },
        ],
      },
      sourceGet: (fp) => (fp === '/workspace/app.ts' ? 'x' : 'y'),
    });

    if (!('Ok' in result) || !result.Ok) {
      throw new Error('expected Ok');
    }
    expect(result.Ok.edits.length).toBe(2);
    const uris = result.Ok.edits.map((e) => e.uri).sort();
    expect(uris).toEqual(['file:///workspace/app.ts', 'file:///workspace/other.ts']);
  });
});

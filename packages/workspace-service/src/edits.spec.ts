import { describe, expect, it } from 'vitest';
import { fileWorkspaceEditsNormalize, workspaceEditPlanCreateFromFix } from './edits';

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
});

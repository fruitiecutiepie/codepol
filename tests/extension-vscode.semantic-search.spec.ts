import { describe, expect, it } from 'vitest';
import type { WorkspaceSearchResult } from '@codepol/core';
import {
  semanticSearchInitialQueryResolve,
  semanticSearchQuickPickItemsCreate,
} from '../extension-vscode/src/semanticSearch';

function editorStubCreate(input: {
  selectionText?: string;
  wordText?: string;
  hasSelection?: boolean;
}) {
  return {
    selection: {
      isEmpty: input.hasSelection === true ? false : true,
      active: { line: 2, character: 4 },
    },
    document: {
      getText(range?: unknown): string {
        return range ? input.selectionText ?? input.wordText ?? '' : '';
      },
      getWordRangeAtPosition(): unknown {
        return input.wordText ? { start: {}, end: {} } : undefined;
      },
    },
  };
}

describe('extension-vscode semantic search helpers', () => {
  it('prefers the active selection over the current word when seeding the query', () => {
    const editor = editorStubCreate({
      hasSelection: true,
      selectionText: 'sharedValue',
      wordText: 'shared',
    });

    expect(semanticSearchInitialQueryResolve(editor)).toBe('sharedValue');
  });

  it('formats quick-pick items for module and exported symbol results', () => {
    const results: WorkspaceSearchResult[] = [
      {
        name: 'shared.ts',
        kind: 'module',
        location: {
          uri: 'file:///workspace/src/shared.ts',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
        detail: 'src/shared.ts',
        source: 'codepol',
        semanticClass: 'workspace_module',
        score: 90,
      },
      {
        name: 'sharedValue',
        kind: 'exported_symbol',
        location: {
          uri: 'file:///workspace/src/shared.ts',
          range: {
            start: { line: 1, character: 13 },
            end: { line: 1, character: 24 },
          },
        },
        detail: 'src/shared.ts • const',
        source: 'codepol',
        semanticClass: 'exported_symbol',
        score: 180,
      },
    ];

    expect(semanticSearchQuickPickItemsCreate(results, 'shared')).toEqual([
      {
        label: 'shared.ts',
        description: 'module',
        detail: 'src/shared.ts',
        result: results[0],
      },
      {
        label: 'sharedValue',
        description: 'exported symbol',
        detail: 'src/shared.ts • const • line 2',
        result: results[1],
      },
    ]);
  });

  it('returns a placeholder item when no semantic search results match', () => {
    expect(semanticSearchQuickPickItemsCreate([], 'missing')).toEqual([
      {
        label: 'No matches for "missing"',
        description: 'Codepol semantic search',
        detail: 'Refine the query or press Escape to close.',
        alwaysShow: true,
      },
    ]);
  });
});

import type { WorkspaceSearchResult } from '@codepol/core';

export type SemanticSearchEditorLike = {
  selection: {
    isEmpty: boolean;
    active: {
      line: number;
      character: number;
    };
  };
  document: {
    getText(range?: unknown): string;
    getWordRangeAtPosition(position: {
      line: number;
      character: number;
    }): unknown;
  };
};

export type SemanticSearchQuickPickItemModel = {
  label: string;
  description?: string;
  detail?: string;
  result?: WorkspaceSearchResult;
  alwaysShow?: boolean;
};

function semanticSearchResultKindLabelResolve(
  result: WorkspaceSearchResult,
): string {
  return result.kind === 'module' ? 'module' : 'exported symbol';
}

function semanticSearchResultDetailResolve(
  result: WorkspaceSearchResult,
): string | undefined {
  const base = result.detail;
  if (result.kind !== 'exported_symbol') {
    return base;
  }

  const lineLabel = `line ${result.location.range.start.line + 1}`;
  return base ? `${base} • ${lineLabel}` : lineLabel;
}

export function semanticSearchInitialQueryResolve(
  editor: SemanticSearchEditorLike | undefined,
): string | undefined {
  if (!editor) {
    return undefined;
  }

  if (!editor.selection.isEmpty) {
    const selectedText = editor.document.getText(editor.selection).trim();
    if (selectedText.length > 0) {
      return selectedText;
    }
  }

  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
  if (!wordRange) {
    return undefined;
  }

  const word = editor.document.getText(wordRange).trim();
  return word.length > 0 ? word : undefined;
}

export function semanticSearchQuickPickItemsCreate(
  results: WorkspaceSearchResult[],
  query: string,
): SemanticSearchQuickPickItemModel[] {
  if (results.length === 0) {
    const normalizedQuery = query.trim();
    return [
      {
        label:
          normalizedQuery.length > 0
            ? `No matches for "${normalizedQuery}"`
            : 'No semantic search results',
        description: 'Codepol semantic search',
        detail: 'Refine the query or press Escape to close.',
        alwaysShow: true,
      },
    ];
  }

  return results.map((result) => ({
    label: result.name,
    description: semanticSearchResultKindLabelResolve(result),
    detail: semanticSearchResultDetailResolve(result),
    result,
  }));
}

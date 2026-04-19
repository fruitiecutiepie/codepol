/**
 * View-model for the per-symbol CodeLens.
 *
 * Mirrors the file-level `architectureCodeLensViewModels` shape: the
 * provider stays trivial (map data → titles, click → command args)
 * and the deterministic title formatting lives here so unit tests
 * pin it without touching VS Code APIs.
 *
 * One lens per indexed function/method declaration in the file.
 * Title format: `<callerCount> callers · <calleeCount> callees`.
 * Click target: the new `codepol.extension.showCallGraph` command,
 * scoped to the symbol via the lens's command argument.
 */

import type {
  WorkspaceSymbolWithCallCounts,
  WorkspaceSymbolsInFileWithCallCountsResult,
} from '@codepol/core';

/**
 * Argument passed to the showCallGraph command when the user clicks
 * the lens. The command resolves the symbol via this id (no cursor
 * round-trip needed) and uses `focusSymbolName` for the panel title.
 */
export type SymbolCallGraphCommandArgument = {
  symbolId: string;
  focusSymbolName: string;
};

export type SymbolCodeLensViewModel = {
  /** Deterministic title text rendered as the CodeLens. */
  title: string;
  /** Hover tooltip for the lens. */
  tooltip: string;
  /** Editor line / character at which the lens anchors (0-based). */
  line: number;
  character: number;
  /** Symbol id the lens click should open the call graph for. */
  symbolId: string;
  /** Display name shown in the call-graph panel header. */
  focusSymbolName: string;
  /** Underlying counts; useful for tests and debug rendering. */
  callerCount: number;
  calleeCount: number;
};

function pluralLabelCreate(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function symbolDisplayNameResolve(item: WorkspaceSymbolWithCallCounts): string {
  return item.symbol.name.length > 0 ? item.symbol.name : '<anonymous>';
}

/**
 * Build the per-symbol lens for a single counted symbol. Callers
 * filter to function / method kinds upstream — this helper does NOT
 * re-validate the kind so view-model tests can exercise it freely.
 */
export function symbolCodeLensViewModelCreate(input: {
  item: WorkspaceSymbolWithCallCounts;
}): SymbolCodeLensViewModel {
  const { item } = input;
  const displayName = symbolDisplayNameResolve(item);
  const callerLabel = pluralLabelCreate(item.callerCount, 'caller', 'callers');
  const calleeLabel = pluralLabelCreate(item.calleeCount, 'callee', 'callees');
  return {
    title: `Codepol: ${callerLabel} \u00b7 ${calleeLabel}`,
    tooltip: `Show call graph for ${displayName}`,
    line: item.symbol.declarationRange.start.line,
    character: item.symbol.declarationRange.start.character,
    symbolId: item.symbol.symbolId,
    focusSymbolName: displayName,
    callerCount: item.callerCount,
    calleeCount: item.calleeCount,
  };
}

/**
 * Build the lens list for a single file. Skips the file's anonymous
 * default exports (those have no `symbolId` to lens into) and keeps
 * the workspace-service ordering — already deterministic by
 * `(line, character, symbolId)` per the RPC contract.
 */
export function symbolCodeLensViewModelsCreate(input: {
  result: WorkspaceSymbolsInFileWithCallCountsResult;
}): SymbolCodeLensViewModel[] {
  const out: SymbolCodeLensViewModel[] = [];
  for (const item of input.result.items) {
    if (!item.symbol.symbolId) continue;
    out.push(symbolCodeLensViewModelCreate({ item }));
  }
  return out;
}

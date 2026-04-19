/**
 * View-model for the per-interface "implementers" CodeLens.
 *
 * Phase 9.5 / Gap 3 — sibling to `symbolCodeLensViewModels` (per
 * function/method) and `architectureCodeLensViewModels` (file-level
 * importers/importees). One job: convert a
 * {@link WorkspaceDependencyGraphResult} centered on an interface
 * into a deterministic CodeLens title that surfaces the implementer
 * counts split by confidence tier.
 *
 * Title format examples:
 * - `Codepol: 0 implementers` (interface with no subtypes)
 * - `Codepol: 3 implementers` (declared only)
 * - `Codepol: 5 implementers (2 shape-matched)` (mixed)
 * - `Codepol: 5 implementers (2 shape-matched, 3 from language server)`
 *
 * The view model returns `null` when no edges exist; the provider
 * suppresses the lens entirely in that case so noise stays minimal.
 *
 * The provider passes `includeStructural: true` so users see the
 * shape-matched count by default; the suffix makes the additional
 * tier visually distinct from declared implementers.
 */

import type { WorkspaceDependencyGraphResult } from '@codepol/core';

export type TypeHierarchyCodeLensCommandArgument = {
  symbolId: string;
  focusSymbolName: string;
};

export type TypeHierarchyCodeLensViewModel = {
  /** Deterministic title text rendered as the CodeLens. */
  title: string;
  /** Hover tooltip for the lens. */
  tooltip: string;
  /** Editor line / character at which the lens anchors (0-based). */
  line: number;
  character: number;
  /** Symbol id the lens click should open the type hierarchy for. */
  symbolId: string;
  /** Display name shown in the type-hierarchy panel header. */
  focusSymbolName: string;
  /** Per-tier implementer counts; useful for tests and debug rendering. */
  declaredCount: number;
  shapeMatchedCount: number;
  typeAwareCount: number;
};

function pluralLabelCreate(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Build the lens for one interface symbol given the type-hierarchy
 * result the provider just fetched. Returns `null` when no edges
 * exist (no implementers across any tier) — the caller drops the lens
 * to keep the editor margin clean.
 *
 * Edges in `WorkspaceDependencyGraphResult` for type hierarchy are
 * oriented `from = subtype, to = supertype`; we only count edges whose
 * `toUri` matches the interface's synthetic URI to avoid double-
 * counting when `direction: 'both'` returns extra layout context.
 */
export function typeHierarchyCodeLensViewModelCreate(input: {
  result: WorkspaceDependencyGraphResult;
  focusSymbolId: string;
  focusSymbolName: string;
  line: number;
  character: number;
}): TypeHierarchyCodeLensViewModel | null {
  const focusUri = `codepol-symbol://${encodeURIComponent(input.focusSymbolId)}`;

  let declaredCount = 0;
  let shapeMatchedCount = 0;
  let typeAwareCount = 0;
  for (const edge of input.result.edges) {
    if (edge.toUri !== focusUri) continue;
    if (edge.typeRelationConfidence === 'structural-shape') {
      shapeMatchedCount += 1;
    } else if (edge.typeRelationConfidence === 'type-aware') {
      typeAwareCount += 1;
    } else {
      // Absent ⇒ declared, per the workspace contract.
      declaredCount += 1;
    }
  }

  const total = declaredCount + shapeMatchedCount + typeAwareCount;
  if (total === 0) {
    return null;
  }

  const suffixParts: string[] = [];
  if (shapeMatchedCount > 0) {
    suffixParts.push(`${shapeMatchedCount} shape-matched`);
  }
  if (typeAwareCount > 0) {
    suffixParts.push(`${typeAwareCount} from language server`);
  }
  const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(', ')})` : '';

  const title = `Codepol: ${pluralLabelCreate(total, 'implementer', 'implementers')}${suffix}`;
  const displayName =
    input.focusSymbolName.length > 0 ? input.focusSymbolName : '<anonymous>';

  return {
    title,
    tooltip: `Show type hierarchy for ${displayName}`,
    line: input.line,
    character: input.character,
    symbolId: input.focusSymbolId,
    focusSymbolName: displayName,
    declaredCount,
    shapeMatchedCount,
    typeAwareCount,
  };
}

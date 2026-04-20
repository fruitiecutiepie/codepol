/**
 * View-model for the per-export importer-count CodeLens.
 *
 * Phase 5 follow-up — sibling to {@link architectureCodeLensViewModels}
 * (file-level), {@link symbolCodeLensViewModels} (per function/method),
 * and {@link typeHierarchyCodeLensViewModels} (per interface). This
 * view-model anchors above each top-level `export` declaration and
 * surfaces the per-symbol importer count returned by
 * `querySymbolImporterCount`.
 *
 * Title format examples:
 * - `Codepol: 1 importer`
 * - `Codepol: 3 importers`
 *
 * Returns `null` when `importerCount === 0` so unimported exports stay
 * quiet — matches the "3 importers" framing in the user-facing doc and
 * keeps the editor margin clean for exports nobody depends on.
 *
 * The lens click target is `codepol.architecture.peek` with the
 * declaration's `{ uri, position }`. The peek command's symbol-aware
 * routing (Phase 5 follow-up) opens the right panel based on symbol
 * kind: function/method → call graph, class/interface/type → type
 * hierarchy, otherwise → file-level impact radius.
 */

export type ExportCodeLensCommandArgument = {
  uri: string;
  position: { line: number; character: number };
};

export type ExportCodeLensViewModel = {
  /** Deterministic title text rendered as the CodeLens. */
  title: string;
  /** Hover tooltip for the lens. */
  tooltip: string;
  /** Editor line / character at which the lens anchors (0-based). */
  line: number;
  character: number;
  /** Importer count surfaced in the title. */
  importerCount: number;
  /** Click-target argument shape for the peek command. */
  commandArgument: ExportCodeLensCommandArgument;
};

function pluralLabelCreate(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function exportCodeLensViewModelCreate(input: {
  importerCount: number;
  declarationName: string;
  declarationUri: string;
  declarationLine: number;
  declarationCharacter: number;
}): ExportCodeLensViewModel | null {
  if (input.importerCount <= 0) {
    return null;
  }
  const displayName =
    input.declarationName.length > 0 ? input.declarationName : '<anonymous>';
  return {
    title: `Codepol: ${pluralLabelCreate(input.importerCount, 'importer', 'importers')}`,
    tooltip: `Peek Codepol architecture for ${displayName}`,
    line: input.declarationLine,
    character: input.declarationCharacter,
    importerCount: input.importerCount,
    commandArgument: {
      uri: input.declarationUri,
      position: {
        line: input.declarationLine,
        character: input.declarationCharacter,
      },
    },
  };
}

/**
 * View model for the per-import-specifier hover (deferred Phase 5
 * user-facing).
 *
 * Identity rule (`TODO_CODEPOL_LSP_HOVER_MODEL.md`): the provider must
 * own the marker. This view model is the renderer half — it assumes
 * the provider has already resolved the marker (via
 * `ImportSpecifierMarkerController.markerAt`) and fetched the
 * neighborhood graph. The view model is pure (no `vscode` import) so
 * unit tests do not need an editor host.
 *
 * Card shape mirrors the Phase 5 spec from
 * `TODO_CODEPOL_LSP_ARCHITECTURE_GRAPH_MODEL.md` (`On an import
 * specifier, attach a Codepol hover card with `{ importerCount,
 * importeeCount, edgeKind, crossesLayerBoundary }``) and stays inside
 * the size limits of `TODO_CODEPOL_LSP_HOVER_MODEL.md` (max 5 fields,
 * max 1 action). When the impact-radius result carries no metric for
 * the resolved module, the renderer returns `null` so the provider can
 * drop the hover entirely.
 */

import type { WorkspaceDependencyGraphResult } from '@codepol/core';

export type ImportSpecifierHoverField = {
  label: string;
  value: string;
};

export type ImportSpecifierHoverViewModel = {
  /**
   * Pre-formatted Markdown body. Lines are joined with `\n\n` so each
   * paragraph renders as its own block in the editor's Markdown
   * surface. Action links use `command:` URIs that the provider must
   * mark as trusted before passing to `vscode.MarkdownString`.
   */
  markdown: string;
  /**
   * Structured fields used by tests (and any future consumer that
   * wants to render the hover differently). Mirrors the order used in
   * `markdown`.
   */
  fields: ImportSpecifierHoverField[];
};

export type ImportSpecifierHoverInput = {
  /**
   * URI of the resolved imported module — the focus of the
   * impact-radius query and the target of the action link.
   */
  resolvedModuleUri: string;
  /** Workspace-relative path of the resolved module (for the title). */
  resolvedModuleWorkspaceRelativePath: string;
  /**
   * Dominant syntactic style of the import. Used in the `Edge kind`
   * field.
   */
  edgeKind: import('@codepol/core').WorkspaceDependencyGraphEdgeKind;
  /**
   * True when the importer and importee belong to different
   * architectural layers. Renders the `Crosses layer boundary` field
   * when true; omitted when false / undefined.
   */
  crossesLayerBoundary?: boolean;
  /**
   * True when the importer and importee belong to different monorepo
   * packages. Surfaces in the tooltip-style supporting text but does
   * not produce its own field — the layer boundary is the headline
   * signal per Phase 5.
   */
  crossesPackageBoundary?: boolean;
  /**
   * Impact radius for `resolvedModuleUri`. Used to derive importer /
   * importee counts. The provider passes `null` (or an empty subgraph)
   * when the daemon has nothing to report — the view model returns
   * `null` in that case so no Codepol hover is shown.
   */
  graph?: WorkspaceDependencyGraphResult | null;
  /**
   * Command id wired to `codepol.architecture.peek`. Optional — when
   * omitted the markdown does not include the action link, which is
   * what unit tests use to keep the rendered output decoupled from the
   * extension manifest.
   */
  peekCommandId?: string;
};

/**
 * Build the hover view model. Returns `null` when the provider has no
 * meaningful card to render — the provider treats that as "no hover",
 * so VSCode falls back to the next hover provider.
 */
export function importSpecifierHoverViewModelCreate(
  input: ImportSpecifierHoverInput,
): ImportSpecifierHoverViewModel | null {
  const graph = input.graph ?? undefined;
  const importerCount = graph
    ? graph.edges.filter((edge) => edge.toUri === input.resolvedModuleUri)
        .length
    : 0;
  const importeeCount = graph
    ? graph.edges.filter((edge) => edge.fromUri === input.resolvedModuleUri)
        .length
    : 0;

  // Hover is meaningful only when at least one structural metric
  // applies. When the impact radius is empty AND we have no boundary
  // signal, the card would be a single edge-kind field — too thin to
  // surface as a separate Codepol hover beside the language server.
  const hasBoundarySignal =
    input.crossesLayerBoundary === true ||
    input.crossesPackageBoundary === true;
  const hasGraphSignal = importerCount > 0 || importeeCount > 0;
  if (!hasGraphSignal && !hasBoundarySignal) {
    return null;
  }

  const fields: ImportSpecifierHoverField[] = [];
  fields.push({ label: 'Importers', value: String(importerCount) });
  fields.push({ label: 'Importees', value: String(importeeCount) });
  fields.push({ label: 'Edge kind', value: input.edgeKind });
  if (input.crossesLayerBoundary === true) {
    fields.push({ label: 'Crosses layer boundary', value: 'yes' });
  }

  const lines: string[] = [];
  lines.push(
    `**Codepol import** — \`${input.resolvedModuleWorkspaceRelativePath}\``,
  );
  for (const field of fields) {
    lines.push(`- **${field.label}:** ${field.value}`);
  }
  if (input.peekCommandId) {
    const commandUri = `command:${input.peekCommandId}?${encodeURIComponent(
      JSON.stringify([input.resolvedModuleUri]),
    )}`;
    lines.push(`[Open architecture panel](${commandUri})`);
  }

  return {
    markdown: lines.join('\n\n'),
    fields,
  };
}

/**
 * View model for the per-file architecture hover (Phase 8 user-facing).
 *
 * Identity rule (`TODO_CODEPOL_LSP_HOVER_MODEL.md`): Codepol can only
 * return a hover when the hovered range carries an extension-owned
 * marker. The Phase 5 hover work was deferred precisely because no
 * marker layer existed. The Phase 8 architecture lens already
 * establishes a per-file Codepol identity at the head of the document
 * (`CodepolArchitectureCodeLensProvider` registers a single CodeLens at
 * the first line). This view model + the matching provider treat that
 * head-of-document range as the marker, so the hover only fires when
 * the cursor is on the same line the lens is rendered. This keeps the
 * hover inside the hover-model rules without inventing a new marker
 * pipeline.
 *
 * The view model is a pure function — no `vscode` import — so it can be
 * unit-tested without an editor host. The provider that registers it
 * does the marker check (line === 0) and the markdown materialization.
 */

import type {
  WorkspaceArchitectureSummaryResult,
  WorkspaceDependencyGraphResult,
} from '@codepol/core';

export type ArchitectureHoverViewModel = {
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
  fields: ArchitectureHoverField[];
};

export type ArchitectureHoverField = {
  label: string;
  value: string;
};

export type ArchitectureHoverInput = {
  uri: string;
  /**
   * Workspace-relative path used as the title and inside the role
   * label. When the URI is not present in the dependency graph, the
   * provider falls back to the URI itself.
   */
  workspaceRelativePath?: string;
  summary?: WorkspaceArchitectureSummaryResult | null;
  /**
   * Workspace dependency graph. Used to:
   *
   *  - identify the file's role (`entry point`, `cycle member`, `leaf`)
   *  - look up the workspace-relative path when the caller did not pass
   *    one explicitly
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
 * Build the hover view model. Returns `null` when no architecture data
 * is available for the focus URI — the provider treats that as "no
 * hover", so VSCode falls back to the next hover provider.
 */
export function architectureHoverViewModelCreate(
  input: ArchitectureHoverInput,
): ArchitectureHoverViewModel | null {
  const summary = input.summary ?? undefined;
  const graph = input.graph ?? undefined;

  const node = graph?.nodes.find((entry) => entry.uri === input.uri);
  const workspaceRelativePath =
    input.workspaceRelativePath ??
    node?.workspaceRelativePath ??
    input.uri;

  const role = architectureHoverRoleResolve(input.uri, graph);
  const instabilityEntry = summary?.instability?.find(
    (entry) => entry.uri === input.uri,
  );
  const complexityIndex = summary?.complexityHotspots?.findIndex(
    (entry) => entry.uri === input.uri,
  );
  const complexityEntry =
    complexityIndex !== undefined && complexityIndex >= 0
      ? summary!.complexityHotspots![complexityIndex]
      : undefined;
  const cycleSize = architectureHoverCycleSizeResolve(input.uri, graph);

  const hasAnyMetric =
    role !== undefined ||
    instabilityEntry !== undefined ||
    complexityEntry !== undefined ||
    cycleSize !== undefined;
  if (!hasAnyMetric) {
    return null;
  }

  const fields: ArchitectureHoverField[] = [];
  if (role !== undefined) {
    fields.push({ label: 'Role', value: role });
  }
  if (instabilityEntry) {
    fields.push({
      label: 'Instability',
      value: `${instabilityEntry.value.toFixed(2)} (Ce=${instabilityEntry.importeeCount}, Ca=${instabilityEntry.importerCount})`,
    });
  }
  if (complexityEntry !== undefined && complexityIndex !== undefined) {
    const total = summary!.complexityHotspots!.length;
    fields.push({
      label: 'Aggregate cyclomatic complexity',
      value: String(complexityEntry.aggregateCyclomaticComplexity),
    });
    fields.push({
      label: 'Hotspot rank',
      value: `#${complexityIndex + 1} of ${total}`,
    });
  }
  if (cycleSize !== undefined) {
    fields.push({
      label: 'Cycle',
      value: `${cycleSize}-file SCC`,
    });
  }

  const lines: string[] = [];
  lines.push(`**Codepol architecture** — \`${workspaceRelativePath}\``);
  for (const field of fields) {
    lines.push(`- **${field.label}:** ${field.value}`);
  }
  if (input.peekCommandId) {
    const commandUri = `command:${input.peekCommandId}?${encodeURIComponent(JSON.stringify([input.uri]))}`;
    lines.push(`[Open architecture panel](${commandUri})`);
  }

  return {
    markdown: lines.join('\n\n'),
    fields,
  };
}

/**
 * Derive a single-word role label from the dependency graph. Returns
 * `undefined` when the graph is missing or the file is not present in
 * it — the provider treats the absence of any metric as "no hover".
 */
function architectureHoverRoleResolve(
  uri: string,
  graph: WorkspaceDependencyGraphResult | undefined,
): string | undefined {
  if (!graph) return undefined;
  if (!graph.nodes.some((node) => node.uri === uri)) {
    return undefined;
  }
  const inCycle = graph.cycles.some((cycle) => cycle.includes(uri));
  if (inCycle) return 'cycle member';
  if (graph.entryPoints.includes(uri)) return 'entry point';
  const hasOutgoing = graph.edges.some((edge) => edge.fromUri === uri);
  const hasIncoming = graph.edges.some((edge) => edge.toUri === uri);
  if (!hasOutgoing && hasIncoming) return 'leaf';
  if (hasOutgoing && !hasIncoming) return 'entry point';
  return 'module';
}

function architectureHoverCycleSizeResolve(
  uri: string,
  graph: WorkspaceDependencyGraphResult | undefined,
): number | undefined {
  if (!graph) return undefined;
  for (const cycle of graph.cycles) {
    if (cycle.includes(uri)) {
      return cycle.length;
    }
  }
  return undefined;
}

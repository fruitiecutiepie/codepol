/**
 * Phase 8 user-facing test: per-file architecture hover view model.
 *
 * The hover provider that registers `architectureHoverViewModelCreate`
 * gates VSCode hovers on the document's first line so it stays inside
 * the `TODO_CODEPOL_LSP_HOVER_MODEL.md` marker rule (the architecture
 * CodeLens already anchors per-file Codepol identity there). The view
 * model itself is gating-agnostic — these tests exercise the rendering
 * branches directly without a vscode runtime.
 */

import { describe, expect, it } from 'vitest';
import type {
  WorkspaceArchitectureSummaryResult,
  WorkspaceDependencyGraphResult,
} from '@codepol/core';
import { architectureHoverViewModelCreate } from '../extension-vscode/src/architectureHoverViewModel';

const focusUri = 'file:///workspace/src/utils.ts';
const otherUri = 'file:///workspace/src/lib/a.ts';

const baseGraph: WorkspaceDependencyGraphResult = {
  nodes: [
    { uri: focusUri, workspaceRelativePath: 'src/utils.ts' },
    { uri: otherUri, workspaceRelativePath: 'src/lib/a.ts' },
  ],
  edges: [{ fromUri: otherUri, toUri: focusUri }],
  entryPoints: [otherUri],
  cycles: [],
};

const baseSummary: WorkspaceArchitectureSummaryResult = {
  summary: 'Indexed 2 files, 4 symbols, 1 entry points, 0 cycles.',
  indexedFileCount: 2,
  symbolCount: 4,
  scopeCount: 2,
  relationCount: 1,
  entryPointCount: 1,
  cycleCount: 0,
  hotspots: [],
  instability: [
    {
      uri: focusUri,
      workspaceRelativePath: 'src/utils.ts',
      value: 0,
      importerCount: 1,
      importeeCount: 0,
    },
  ],
  complexityHotspots: [
    {
      uri: focusUri,
      workspaceRelativePath: 'src/utils.ts',
      aggregateCyclomaticComplexity: 14,
      importerCount: 1,
      score: 14,
    },
  ],
};

describe('architectureHoverViewModelCreate', () => {
  it('renders role, instability, complexity, and hotspot rank for a file in both summary and graph', () => {
    const result = architectureHoverViewModelCreate({
      uri: focusUri,
      summary: baseSummary,
      graph: baseGraph,
    });
    expect(result).not.toBeNull();
    expect(result!.fields).toEqual([
      { label: 'Role', value: 'leaf' },
      { label: 'Instability', value: '0.00 (Ce=0, Ca=1)' },
      { label: 'Aggregate cyclomatic complexity', value: '14' },
      { label: 'Hotspot rank', value: '#1 of 1' },
    ]);
    expect(result!.markdown).toContain('**Codepol architecture**');
    expect(result!.markdown).toContain('`src/utils.ts`');
    expect(result!.markdown).toContain('Instability:** 0.00');
    expect(result!.markdown).toContain('Hotspot rank:** #1 of 1');
    // Without a peekCommandId no action link is rendered.
    expect(result!.markdown).not.toContain('command:');
  });

  it('reports cycle membership and SCC size when the file is in a cycle', () => {
    const a = 'file:///workspace/src/cyc/a.ts';
    const b = 'file:///workspace/src/cyc/b.ts';
    const graph: WorkspaceDependencyGraphResult = {
      nodes: [
        { uri: a, workspaceRelativePath: 'src/cyc/a.ts' },
        { uri: b, workspaceRelativePath: 'src/cyc/b.ts' },
      ],
      edges: [
        { fromUri: a, toUri: b },
        { fromUri: b, toUri: a },
      ],
      entryPoints: [],
      cycles: [[a, b]],
    };
    const result = architectureHoverViewModelCreate({
      uri: a,
      graph,
    });
    expect(result).not.toBeNull();
    const labels = result!.fields.map((field) => field.label);
    expect(labels).toContain('Role');
    expect(labels).toContain('Cycle');
    const cycleField = result!.fields.find((field) => field.label === 'Cycle');
    expect(cycleField?.value).toBe('2-file SCC');
    const roleField = result!.fields.find((field) => field.label === 'Role');
    expect(roleField?.value).toBe('cycle member');
  });

  it('returns null when the file has no metrics in either summary or graph', () => {
    const result = architectureHoverViewModelCreate({
      uri: 'file:///workspace/src/nowhere.ts',
      summary: baseSummary,
      graph: baseGraph,
    });
    expect(result).toBeNull();
  });

  it('returns null when summary is null and the file is not in the dependency graph', () => {
    const result = architectureHoverViewModelCreate({
      uri: 'file:///workspace/src/nowhere.ts',
      summary: null,
      graph: null,
    });
    expect(result).toBeNull();
  });

  it('appends a command link when a peekCommandId is supplied and trusts the URI shape', () => {
    const result = architectureHoverViewModelCreate({
      uri: focusUri,
      summary: baseSummary,
      graph: baseGraph,
      peekCommandId: 'codepol.architecture.peek',
    });
    expect(result).not.toBeNull();
    const expectedArgument = encodeURIComponent(JSON.stringify([focusUri]));
    expect(result!.markdown).toContain(
      `[Open architecture panel](command:codepol.architecture.peek?${expectedArgument})`,
    );
  });

  it('produces deterministic ordering of fields in the markdown body', () => {
    const first = architectureHoverViewModelCreate({
      uri: focusUri,
      summary: baseSummary,
      graph: baseGraph,
    });
    const second = architectureHoverViewModelCreate({
      uri: focusUri,
      summary: baseSummary,
      graph: baseGraph,
    });
    expect(first!.markdown).toEqual(second!.markdown);
  });
});

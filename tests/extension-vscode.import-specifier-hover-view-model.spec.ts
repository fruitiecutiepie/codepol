/**
 * Pure unit tests for the import-specifier hover view model.
 *
 * The view model is the renderer half of the deferred Phase 5 hover.
 * The provider half is covered by
 * `extension-vscode.import-specifier-hover-provider.spec.ts`. Splitting
 * the two keeps the renderer free of any `vscode` import and lets us
 * pin the rendered Markdown byte-for-byte.
 */
import { describe, expect, it } from 'vitest';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';
import { importSpecifierHoverViewModelCreate } from '../extension-vscode/src/importSpecifierHoverViewModel';

const helperUri = 'file:///workspace/src/helper.ts';
const importerUri = 'file:///workspace/src/importer.ts';
const otherUri = 'file:///workspace/src/other.ts';

function graphCreate(): WorkspaceDependencyGraphResult {
  return {
    nodes: [
      { uri: helperUri, workspaceRelativePath: 'src/helper.ts' },
      { uri: importerUri, workspaceRelativePath: 'src/importer.ts' },
      { uri: otherUri, workspaceRelativePath: 'src/other.ts' },
    ],
    edges: [
      // Two importers of helper.ts.
      { fromUri: importerUri, toUri: helperUri },
      { fromUri: otherUri, toUri: helperUri },
      // helper.ts depends on one downstream module (other.ts) — gives
      // the card a non-zero importee count.
      { fromUri: helperUri, toUri: otherUri },
    ],
    entryPoints: [],
    cycles: [],
  };
}

describe('importSpecifierHoverViewModelCreate', () => {
  it('renders importers, importees, and edge kind plus the action link when peekCommandId is set', () => {
    const viewModel = importSpecifierHoverViewModelCreate({
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      graph: graphCreate(),
      peekCommandId: 'codepol.architecture.peek',
    });
    expect(viewModel).not.toBeNull();
    expect(viewModel!.fields).toEqual([
      { label: 'Importers', value: '2' },
      { label: 'Importees', value: '1' },
      { label: 'Edge kind', value: 'static' },
    ]);
    expect(viewModel!.markdown).toContain('**Codepol import**');
    expect(viewModel!.markdown).toContain('`src/helper.ts`');
    expect(viewModel!.markdown).toContain('- **Importers:** 2');
    expect(viewModel!.markdown).toContain('- **Importees:** 1');
    expect(viewModel!.markdown).toContain('- **Edge kind:** static');
    expect(viewModel!.markdown).toContain(
      'command:codepol.architecture.peek',
    );
    // Encoded URI argument carries the resolved module URI.
    expect(viewModel!.markdown).toContain(
      encodeURIComponent(JSON.stringify([helperUri])),
    );
  });

  it('omits the Crosses layer boundary field when the marker reports no boundary', () => {
    const viewModel = importSpecifierHoverViewModelCreate({
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      crossesLayerBoundary: false,
      graph: graphCreate(),
    });
    expect(viewModel).not.toBeNull();
    expect(
      viewModel!.fields.some((field) => field.label === 'Crosses layer boundary'),
    ).toBe(false);
  });

  it('renders Crosses layer boundary when true', () => {
    const viewModel = importSpecifierHoverViewModelCreate({
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      crossesLayerBoundary: true,
      graph: graphCreate(),
    });
    expect(viewModel).not.toBeNull();
    expect(viewModel!.fields).toContainEqual({
      label: 'Crosses layer boundary',
      value: 'yes',
    });
    expect(viewModel!.markdown).toContain('Crosses layer boundary:');
  });

  it('omits the action link entirely when peekCommandId is not provided', () => {
    const viewModel = importSpecifierHoverViewModelCreate({
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      graph: graphCreate(),
    });
    expect(viewModel).not.toBeNull();
    expect(viewModel!.markdown).not.toContain('command:');
    expect(viewModel!.markdown).not.toContain('Open architecture panel');
  });

  it('returns null when neither the graph nor a boundary signal carries a metric', () => {
    // Empty graph + no boundary signal → too thin to render. The
    // provider treats null as "no Codepol hover, fall through to the
    // language server" per TODO_CODEPOL_LSP_HOVER_MODEL.md.
    const viewModel = importSpecifierHoverViewModelCreate({
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      graph: { nodes: [], edges: [], entryPoints: [], cycles: [] },
    });
    expect(viewModel).toBeNull();
  });

  it('renders a card when the graph is empty but the marker carries a boundary signal', () => {
    const viewModel = importSpecifierHoverViewModelCreate({
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      crossesLayerBoundary: true,
      graph: { nodes: [], edges: [], entryPoints: [], cycles: [] },
    });
    expect(viewModel).not.toBeNull();
    expect(viewModel!.fields).toEqual([
      { label: 'Importers', value: '0' },
      { label: 'Importees', value: '0' },
      { label: 'Edge kind', value: 'static' },
      { label: 'Crosses layer boundary', value: 'yes' },
    ]);
  });
});

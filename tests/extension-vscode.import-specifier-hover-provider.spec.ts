/**
 * Class-boundary tests for `CodepolImportSpecifierHoverProvider`.
 *
 * The view-model spec
 * (`tests/extension-vscode.import-specifier-hover-view-model.spec.ts`)
 * covers the pure rendering helper. This spec pins the provider's
 * outer-edge contract for the deferred Phase 5 hover:
 *
 * - returns `null` for non-`file:` documents without consulting the
 *   protocol or the marker controller
 * - returns `null` when the marker controller has no marker at the
 *   cursor position (identity gate from
 *   `TODO_CODEPOL_LSP_HOVER_MODEL.md`); does NOT consult the protocol
 *   in that case
 * - on a marker hit, fans `queryImpactRadius` against the marker's
 *   resolved module URI and anchors the hover to `marker.range`
 * - swallows `request_superseded` from the protocol
 * - rethrows any other failure
 * - constructs a trusted `MarkdownString` (so `command:` links work)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';
import type { ImportSpecifierMarker } from '../extension-vscode/src/importSpecifierMarkerController';

vi.mock('vscode', () => {
  class FakeRange {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number,
    ) {}
    contains(position: { line: number; character: number }): boolean {
      if (position.line < this.startLine || position.line > this.endLine) {
        return false;
      }
      if (
        position.line === this.startLine &&
        position.character < this.startCharacter
      ) {
        return false;
      }
      if (
        position.line === this.endLine &&
        position.character > this.endCharacter
      ) {
        return false;
      }
      return true;
    }
  }
  class FakePosition {
    constructor(public line: number, public character: number) {}
  }
  class FakeMarkdownString {
    isTrusted = false;
    supportThemeIcons = false;
    constructor(public value: string) {}
  }
  class FakeHover {
    constructor(
      public contents: FakeMarkdownString | string,
      public range?: FakeRange,
    ) {}
  }
  class FakeCancellationTokenSource {
    token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
    cancel(): void {
      this.token.isCancellationRequested = true;
    }
    dispose(): void {}
  }
  return {
    Range: FakeRange,
    Position: FakePosition,
    MarkdownString: FakeMarkdownString,
    Hover: FakeHover,
    CancellationTokenSource: FakeCancellationTokenSource,
  };
});

type FakeDocument = {
  uri: { scheme: string; toString(): string };
};

function fakeDocumentCreate(scheme: string, raw: string): FakeDocument {
  return {
    uri: {
      scheme,
      toString: () => raw,
    },
  };
}

function requestSupersededErrorCreate(): Error & {
  code: string;
  data: { kind: string };
} {
  const error = new Error('Request superseded') as Error & {
    code: string;
    data: { kind: string };
  };
  error.code = 'request_superseded';
  error.data = { kind: 'request_superseded' };
  return error;
}

const importerUri = 'file:///workspace/src/importer.ts';
const helperUri = 'file:///workspace/src/helper.ts';

function markerCreate(): ImportSpecifierMarker {
  // Use the fake vscode Range available via `await import('vscode')`.
  // We construct the marker lazily in tests so the mock is in place.
  return {} as ImportSpecifierMarker;
}

function neighborhoodGraphCreate(): WorkspaceDependencyGraphResult {
  return {
    nodes: [
      { uri: helperUri, workspaceRelativePath: 'src/helper.ts' },
      { uri: importerUri, workspaceRelativePath: 'src/importer.ts' },
    ],
    edges: [{ fromUri: importerUri, toUri: helperUri }],
    entryPoints: [importerUri],
    cycles: [],
  };
}

describe('CodepolImportSpecifierHoverProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for non-file URIs without consulting the protocol or markers', async () => {
    const { CodepolImportSpecifierHoverProvider } = await import(
      '../extension-vscode/src/importSpecifierHoverProvider'
    );
    const queryImpactRadius = vi.fn();
    const markerAt = vi.fn();
    const provider = new CodepolImportSpecifierHoverProvider({
      protocol: { queryImpactRadius },
      markers: { markerAt },
      peekCommandId: 'codepol.architecture.peek',
    });
    const vscode = await import('vscode');
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = await provider.provideHover(
      fakeDocumentCreate('untitled', 'untitled:Untitled-1') as never,
      new vscode.Position(0, 0) as never,
      tokenSource.token as never,
    );
    expect(hover).toBeNull();
    expect(queryImpactRadius).not.toHaveBeenCalled();
    expect(markerAt).not.toHaveBeenCalled();
  });

  it('returns null when the marker controller has no marker at the position; does NOT consult the protocol', async () => {
    const { CodepolImportSpecifierHoverProvider } = await import(
      '../extension-vscode/src/importSpecifierHoverProvider'
    );
    const queryImpactRadius = vi.fn();
    const markerAt = vi.fn().mockReturnValue(undefined);
    const provider = new CodepolImportSpecifierHoverProvider({
      protocol: { queryImpactRadius },
      markers: { markerAt },
      peekCommandId: 'codepol.architecture.peek',
    });
    const vscode = await import('vscode');
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = await provider.provideHover(
      fakeDocumentCreate('file', importerUri) as never,
      new vscode.Position(7, 12) as never,
      tokenSource.token as never,
    );
    expect(hover).toBeNull();
    expect(markerAt).toHaveBeenCalledTimes(1);
    expect(queryImpactRadius).not.toHaveBeenCalled();
  });

  it('builds a trusted Markdown hover anchored at the marker range when a marker hit fans queryImpactRadius', async () => {
    const { CodepolImportSpecifierHoverProvider } = await import(
      '../extension-vscode/src/importSpecifierHoverProvider'
    );
    const vscode = await import('vscode');
    const range = new vscode.Range(0, 0, 0, 32);
    const marker: ImportSpecifierMarker = {
      range: range as never,
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      bindingCount: 1,
    };
    const queryImpactRadius = vi
      .fn()
      .mockResolvedValue(neighborhoodGraphCreate());
    const markerAt = vi.fn().mockReturnValue(marker);
    const provider = new CodepolImportSpecifierHoverProvider({
      protocol: { queryImpactRadius },
      markers: { markerAt },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = (await provider.provideHover(
      fakeDocumentCreate('file', importerUri) as never,
      new vscode.Position(0, 8) as never,
      tokenSource.token as never,
    )) as unknown as {
      contents: { value: string; isTrusted: boolean; supportThemeIcons: boolean };
      range: { startLine: number; endLine: number; startCharacter: number; endCharacter: number };
    } | null;

    expect(queryImpactRadius).toHaveBeenCalledTimes(1);
    expect(queryImpactRadius).toHaveBeenCalledWith({
      uri: helperUri,
      direction: 'both',
      depth: 1,
    });
    expect(hover).not.toBeNull();
    // Hover range matches the marker range so the editor highlights
    // exactly the import specifier the card describes.
    expect(hover!.range).toBe(range);
    expect(hover!.contents.isTrusted).toBe(true);
    expect(hover!.contents.supportThemeIcons).toBe(true);
    expect(hover!.contents.value).toContain('**Codepol import**');
    expect(hover!.contents.value).toContain('`src/helper.ts`');
    expect(hover!.contents.value).toContain('Importers:');
    expect(hover!.contents.value).toContain(
      'command:codepol.architecture.peek',
    );
  });

  it('returns null when the impact-radius result is empty (no metric to render)', async () => {
    const { CodepolImportSpecifierHoverProvider } = await import(
      '../extension-vscode/src/importSpecifierHoverProvider'
    );
    const vscode = await import('vscode');
    const range = new vscode.Range(0, 0, 0, 32);
    const marker: ImportSpecifierMarker = {
      range: range as never,
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      bindingCount: 1,
    };
    const provider = new CodepolImportSpecifierHoverProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockResolvedValue({
          nodes: [],
          edges: [],
          entryPoints: [],
          cycles: [],
        } satisfies WorkspaceDependencyGraphResult),
      },
      markers: { markerAt: vi.fn().mockReturnValue(marker) },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = await provider.provideHover(
      fakeDocumentCreate('file', importerUri) as never,
      new vscode.Position(0, 8) as never,
      tokenSource.token as never,
    );
    expect(hover).toBeNull();
  });

  it('swallows request_superseded from queryImpactRadius and returns null', async () => {
    const { CodepolImportSpecifierHoverProvider } = await import(
      '../extension-vscode/src/importSpecifierHoverProvider'
    );
    const vscode = await import('vscode');
    const range = new vscode.Range(0, 0, 0, 32);
    const marker: ImportSpecifierMarker = {
      range: range as never,
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      bindingCount: 1,
    };
    const provider = new CodepolImportSpecifierHoverProvider({
      protocol: {
        queryImpactRadius: vi
          .fn()
          .mockRejectedValue(requestSupersededErrorCreate()),
      },
      markers: { markerAt: vi.fn().mockReturnValue(marker) },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = await provider.provideHover(
      fakeDocumentCreate('file', importerUri) as never,
      new vscode.Position(0, 8) as never,
      tokenSource.token as never,
    );
    expect(hover).toBeNull();
  });

  it('rethrows non-superseded queryImpactRadius failures so the editor surfaces them', async () => {
    const { CodepolImportSpecifierHoverProvider } = await import(
      '../extension-vscode/src/importSpecifierHoverProvider'
    );
    const vscode = await import('vscode');
    const range = new vscode.Range(0, 0, 0, 32);
    const marker: ImportSpecifierMarker = {
      range: range as never,
      resolvedModuleUri: helperUri,
      resolvedModuleWorkspaceRelativePath: 'src/helper.ts',
      edgeKind: 'static',
      bindingCount: 1,
    };
    const provider = new CodepolImportSpecifierHoverProvider({
      protocol: {
        queryImpactRadius: vi
          .fn()
          .mockRejectedValue(new Error('graph crash')),
      },
      markers: { markerAt: vi.fn().mockReturnValue(marker) },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new vscode.CancellationTokenSource();

    await expect(
      provider.provideHover(
        fakeDocumentCreate('file', importerUri) as never,
        new vscode.Position(0, 8) as never,
        tokenSource.token as never,
      ),
    ).rejects.toThrow('graph crash');
  });
});

// Silence unused-import lint in TS strict mode; the helper exists for
// readability of the test fixtures even though no test currently uses
// the empty-shell variant.
void markerCreate;

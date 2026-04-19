/**
 * Class-boundary tests for `CodepolArchitectureHoverProvider`.
 *
 * The view-model spec
 * (`tests/extension-vscode.architecture-hover.spec.ts`) covers the
 * pure rendering helper. This spec pins the provider's outer-edge
 * contract introduced by the Phase 8 hover wiring:
 *
 * - returns `null` for non-`file:` documents without consulting the
 *   protocol (scheme gate)
 * - returns `null` for any cursor position outside line 0 — the
 *   marker rule that keeps the hover inside
 *   `TODO_CODEPOL_LSP_HOVER_MODEL.md`
 * - **fans `queryImpactRadius` and `queryArchitectureSummary` in
 *   parallel** on line 0 and degrades to `null` (no hover) when
 *   neither yields a metric
 * - swallows `request_superseded` from either request without throwing
 * - rethrows any other failure
 * - constructs a trusted `MarkdownString` (so `command:` links work)
 *   anchored on a zero-width range at line 0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkspaceArchitectureSummaryResult,
  WorkspaceDependencyGraphResult,
} from '@codepol/core';

vi.mock('vscode', () => {
  class FakeRange {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number,
    ) {}
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

const focusUri = 'file:///workspace/src/utils.ts';

const baseGraph: WorkspaceDependencyGraphResult = {
  nodes: [
    { uri: focusUri, workspaceRelativePath: 'src/utils.ts' },
    {
      uri: 'file:///workspace/src/lib/a.ts',
      workspaceRelativePath: 'src/lib/a.ts',
    },
  ],
  edges: [
    { fromUri: 'file:///workspace/src/lib/a.ts', toUri: focusUri },
  ],
  entryPoints: ['file:///workspace/src/lib/a.ts'],
  cycles: [],
};

const baseSummary: WorkspaceArchitectureSummaryResult = {
  summary: 'Indexed 2 files',
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

describe('CodepolArchitectureHoverProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for non-file URIs without consulting the protocol', async () => {
    const { CodepolArchitectureHoverProvider } = await import(
      '../extension-vscode/src/architectureHoverProvider'
    );
    const queryImpactRadius = vi.fn();
    const queryArchitectureSummary = vi.fn();
    const provider = new CodepolArchitectureHoverProvider({
      protocol: { queryImpactRadius, queryArchitectureSummary },
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
    expect(queryArchitectureSummary).not.toHaveBeenCalled();
  });

  it('returns null for any line other than 0 (marker rule keeps hover inside the architecture lens range)', async () => {
    const { CodepolArchitectureHoverProvider } = await import(
      '../extension-vscode/src/architectureHoverProvider'
    );
    const queryImpactRadius = vi.fn();
    const queryArchitectureSummary = vi.fn();
    const provider = new CodepolArchitectureHoverProvider({
      protocol: { queryImpactRadius, queryArchitectureSummary },
      peekCommandId: 'codepol.architecture.peek',
    });
    const vscode = await import('vscode');
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = await provider.provideHover(
      fakeDocumentCreate('file', focusUri) as never,
      new vscode.Position(5, 12) as never,
      tokenSource.token as never,
    );
    expect(hover).toBeNull();
    expect(queryImpactRadius).not.toHaveBeenCalled();
    expect(queryArchitectureSummary).not.toHaveBeenCalled();
  });

  it('builds a trusted Markdown hover anchored at line 0 when both fan-out queries succeed', async () => {
    const { CodepolArchitectureHoverProvider } = await import(
      '../extension-vscode/src/architectureHoverProvider'
    );
    const queryImpactRadius = vi.fn().mockResolvedValue(baseGraph);
    const queryArchitectureSummary = vi.fn().mockResolvedValue(baseSummary);
    const provider = new CodepolArchitectureHoverProvider({
      protocol: { queryImpactRadius, queryArchitectureSummary },
      peekCommandId: 'codepol.architecture.peek',
    });
    const vscode = await import('vscode');
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = (await provider.provideHover(
      fakeDocumentCreate('file', focusUri) as never,
      new vscode.Position(0, 0) as never,
      tokenSource.token as never,
    )) as unknown as {
      contents: { value: string; isTrusted: boolean; supportThemeIcons: boolean };
      range: { startLine: number; endLine: number; startCharacter: number; endCharacter: number };
    } | null;

    expect(queryImpactRadius).toHaveBeenCalledTimes(1);
    expect(queryArchitectureSummary).toHaveBeenCalledTimes(1);
    expect(hover).not.toBeNull();
    expect(hover!.range.startLine).toBe(0);
    expect(hover!.range.endLine).toBe(0);
    expect(hover!.range.startCharacter).toBe(0);
    expect(hover!.range.endCharacter).toBe(0);
    // `command:` links require `isTrusted = true`; the provider must
    // opt in or the action link in the body silently breaks.
    expect(hover!.contents.isTrusted).toBe(true);
    expect(hover!.contents.supportThemeIcons).toBe(true);
    expect(hover!.contents.value).toContain('**Codepol architecture**');
    expect(hover!.contents.value).toContain('`src/utils.ts`');
    expect(hover!.contents.value).toContain('Aggregate cyclomatic complexity:');
    // Action link uses the configured command id.
    expect(hover!.contents.value).toContain('command:codepol.architecture.peek');
  });

  it('returns null when no metric applies (file outside graph and summary)', async () => {
    const { CodepolArchitectureHoverProvider } = await import(
      '../extension-vscode/src/architectureHoverProvider'
    );
    const provider = new CodepolArchitectureHoverProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockResolvedValue({
          nodes: [],
          edges: [],
          entryPoints: [],
          cycles: [],
        } satisfies WorkspaceDependencyGraphResult),
        queryArchitectureSummary: vi.fn().mockResolvedValue(null),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const vscode = await import('vscode');
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = await provider.provideHover(
      fakeDocumentCreate('file', focusUri) as never,
      new vscode.Position(0, 0) as never,
      tokenSource.token as never,
    );
    expect(hover).toBeNull();
  });

  it('returns null when queryArchitectureSummary rejects with request_superseded but the graph carries no metric for the file', async () => {
    const { CodepolArchitectureHoverProvider } = await import(
      '../extension-vscode/src/architectureHoverProvider'
    );
    const provider = new CodepolArchitectureHoverProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockResolvedValue({
          nodes: [],
          edges: [],
          entryPoints: [],
          cycles: [],
        } satisfies WorkspaceDependencyGraphResult),
        queryArchitectureSummary: vi
          .fn()
          .mockRejectedValue(requestSupersededErrorCreate()),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const vscode = await import('vscode');
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = await provider.provideHover(
      fakeDocumentCreate('file', focusUri) as never,
      new vscode.Position(0, 0) as never,
      tokenSource.token as never,
    );
    expect(hover).toBeNull();
  });

  it('still produces a hover when the summary is unavailable but the graph carries role data', async () => {
    const { CodepolArchitectureHoverProvider } = await import(
      '../extension-vscode/src/architectureHoverProvider'
    );
    // Graph alone (no summary) is enough to derive a `Role` field.
    const provider = new CodepolArchitectureHoverProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockResolvedValue(baseGraph),
        queryArchitectureSummary: vi
          .fn()
          .mockRejectedValue(requestSupersededErrorCreate()),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const vscode = await import('vscode');
    const tokenSource = new vscode.CancellationTokenSource();

    const hover = (await provider.provideHover(
      fakeDocumentCreate('file', focusUri) as never,
      new vscode.Position(0, 0) as never,
      tokenSource.token as never,
    )) as unknown as { contents: { value: string } } | null;
    expect(hover).not.toBeNull();
    // Role is "leaf" (incoming, no outgoing) so the hover is non-empty
    // even without summary data.
    expect(hover!.contents.value).toContain('**Role:** leaf');
    // No instability / complexity sections because the summary is gone.
    expect(hover!.contents.value).not.toContain('Instability:');
    expect(hover!.contents.value).not.toContain('Aggregate cyclomatic complexity');
  });

  it('rethrows non-superseded queryImpactRadius failures so the editor surfaces them', async () => {
    const { CodepolArchitectureHoverProvider } = await import(
      '../extension-vscode/src/architectureHoverProvider'
    );
    const provider = new CodepolArchitectureHoverProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockRejectedValue(new Error('graph crash')),
        queryArchitectureSummary: vi.fn().mockResolvedValue(null),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const vscode = await import('vscode');
    const tokenSource = new vscode.CancellationTokenSource();

    await expect(
      provider.provideHover(
        fakeDocumentCreate('file', focusUri) as never,
        new vscode.Position(0, 0) as never,
        tokenSource.token as never,
      ),
    ).rejects.toThrow('graph crash');
  });
});

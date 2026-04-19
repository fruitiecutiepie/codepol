/**
 * Class-boundary tests for `CodepolArchitectureCodeLensProvider`.
 *
 * The view-model spec
 * (`tests/extension-vscode.architecture-graph-controls.spec.ts`)
 * already covers `architectureCodeLensViewModelCreate`. This spec
 * pins the provider's outer-edge contract introduced by the Phase 8
 * user-facing wiring:
 *
 * - returns `[]` for non-`file:` documents without consulting the
 *   protocol (matches `CodepolSymbolCodeLensProvider`)
 * - returns `[]` when `queryImpactRadius` resolves to `null`
 *   (degraded readiness)
 * - returns `[]` when `queryImpactRadius` rejects with a
 *   `request_superseded` error
 * - rethrows any other `queryImpactRadius` failure
 * - **fans `queryImpactRadius` and `queryArchitectureSummary` in
 *   parallel** and degrades to the legacy importer/importee title
 *   when the summary rejects with `request_superseded` or resolves to
 *   `null` — the lens must never disappear because of a missing
 *   summary
 * - **passes the resolved summary through to
 *   `architectureCodeLensViewModelCreate`**, so the lens title carries
 *   the Phase 8 `I=…` and `complexity …` segments when the focus URI
 *   is a metric-bearing file
 *
 * `vscode` is mocked at the module boundary the same way
 * `tests/extension-vscode.symbol-code-lens-provider.spec.ts` does it.
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
  class FakeCodeLens {
    isResolved = true;
    constructor(
      public range: FakeRange,
      public command: {
        title: string;
        tooltip?: string;
        command: string;
        arguments?: unknown[];
      },
    ) {}
  }
  class FakeEventEmitter {
    private listeners: Array<(value: unknown) => void> = [];
    event = (listener: (value: unknown) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(value?: unknown): void {
      for (const fn of this.listeners) fn(value);
    }
    dispose(): void {
      this.listeners = [];
    }
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
    CodeLens: FakeCodeLens,
    EventEmitter: FakeEventEmitter,
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

// `utils.ts` has Ce=1 (imports leaf) and Ca=1 (imported by lib/a.ts) so
// both the legacy importer/importee counts and the summary's
// `instability` row agree on `1 importer • 1 importee` / I=0.5.
const baseGraph: WorkspaceDependencyGraphResult = {
  nodes: [
    { uri: focusUri, workspaceRelativePath: 'src/utils.ts' },
    {
      uri: 'file:///workspace/src/lib/a.ts',
      workspaceRelativePath: 'src/lib/a.ts',
    },
    {
      uri: 'file:///workspace/src/leaf.ts',
      workspaceRelativePath: 'src/leaf.ts',
    },
  ],
  edges: [
    { fromUri: 'file:///workspace/src/lib/a.ts', toUri: focusUri },
    { fromUri: focusUri, toUri: 'file:///workspace/src/leaf.ts' },
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
      value: 0.5,
      importerCount: 1,
      importeeCount: 1,
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

describe('CodepolArchitectureCodeLensProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns no lenses for non-file URIs without consulting the protocol', async () => {
    const { CodepolArchitectureCodeLensProvider } = await import(
      '../extension-vscode/src/codeLensProvider'
    );
    const queryImpactRadius = vi.fn();
    const queryArchitectureSummary = vi.fn();
    const provider = new CodepolArchitectureCodeLensProvider({
      protocol: { queryImpactRadius, queryArchitectureSummary },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate('untitled', 'untitled:Untitled-1') as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(queryImpactRadius).not.toHaveBeenCalled();
    expect(queryArchitectureSummary).not.toHaveBeenCalled();
  });

  it('returns no lenses when queryImpactRadius resolves to null (degraded readiness)', async () => {
    const { CodepolArchitectureCodeLensProvider } = await import(
      '../extension-vscode/src/codeLensProvider'
    );
    const provider = new CodepolArchitectureCodeLensProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockResolvedValue(null),
        queryArchitectureSummary: vi.fn().mockResolvedValue(baseSummary),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate('file', focusUri) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('returns no lenses when queryImpactRadius rejects with request_superseded (no rethrow)', async () => {
    const { CodepolArchitectureCodeLensProvider } = await import(
      '../extension-vscode/src/codeLensProvider'
    );
    const provider = new CodepolArchitectureCodeLensProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockRejectedValue(requestSupersededErrorCreate()),
        queryArchitectureSummary: vi.fn().mockResolvedValue(baseSummary),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate('file', focusUri) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('rethrows non-superseded queryImpactRadius failures so the editor surfaces them', async () => {
    const { CodepolArchitectureCodeLensProvider } = await import(
      '../extension-vscode/src/codeLensProvider'
    );
    const provider = new CodepolArchitectureCodeLensProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockRejectedValue(new Error('protocol crash')),
        queryArchitectureSummary: vi.fn().mockResolvedValue(null),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    await expect(
      provider.provideCodeLenses(
        fakeDocumentCreate('file', focusUri) as never,
        tokenSource.token as never,
      ),
    ).rejects.toThrow('protocol crash');
  });

  it('emits a lens enriched with Phase 8 segments when the summary fan-out succeeds', async () => {
    const { CodepolArchitectureCodeLensProvider } = await import(
      '../extension-vscode/src/codeLensProvider'
    );
    const queryImpactRadius = vi.fn().mockResolvedValue(baseGraph);
    const queryArchitectureSummary = vi.fn().mockResolvedValue(baseSummary);
    const provider = new CodepolArchitectureCodeLensProvider({
      protocol: { queryImpactRadius, queryArchitectureSummary },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = (await provider.provideCodeLenses(
      fakeDocumentCreate('file', focusUri) as never,
      tokenSource.token as never,
    )) as unknown as Array<{
      range: { startLine: number; endLine: number };
      command: { title: string; command: string; arguments?: unknown[] };
    }>;

    // Both protocol calls must fire — Phase 8 wiring is parallel.
    expect(queryImpactRadius).toHaveBeenCalledTimes(1);
    expect(queryArchitectureSummary).toHaveBeenCalledTimes(1);
    expect(lenses).toHaveLength(1);
    const [lens] = lenses;
    expect(lens.range.startLine).toBe(0);
    expect(lens.command.command).toBe('codepol.architecture.peek');
    expect(lens.command.arguments).toEqual([focusUri]);
    // Title carries both the legacy importer/importee body and the
    // Phase 8 `I=…` / `complexity …` segments because the focus URI is
    // in both `summary.instability` and `summary.complexityHotspots`.
    expect(lens.command.title).toBe(
      'Codepol: 1 importer • 1 importee • I=0.50 • complexity 14',
    );
  });

  it('falls back to the legacy title when queryArchitectureSummary rejects with request_superseded', async () => {
    const { CodepolArchitectureCodeLensProvider } = await import(
      '../extension-vscode/src/codeLensProvider'
    );
    const queryImpactRadius = vi.fn().mockResolvedValue(baseGraph);
    const queryArchitectureSummary = vi
      .fn()
      .mockRejectedValue(requestSupersededErrorCreate());
    const provider = new CodepolArchitectureCodeLensProvider({
      protocol: { queryImpactRadius, queryArchitectureSummary },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = (await provider.provideCodeLenses(
      fakeDocumentCreate('file', focusUri) as never,
      tokenSource.token as never,
    )) as unknown as Array<{
      command: { title: string };
    }>;

    expect(queryImpactRadius).toHaveBeenCalledTimes(1);
    expect(queryArchitectureSummary).toHaveBeenCalledTimes(1);
    expect(lenses).toHaveLength(1);
    // No Phase 8 suffix — the lens degrades cleanly when the summary
    // is unavailable.
    expect(lenses[0]!.command.title).toBe(
      'Codepol: 1 importer • 1 importee',
    );
  });

  it('falls back to the legacy title when queryArchitectureSummary resolves to null', async () => {
    const { CodepolArchitectureCodeLensProvider } = await import(
      '../extension-vscode/src/codeLensProvider'
    );
    const provider = new CodepolArchitectureCodeLensProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockResolvedValue(baseGraph),
        queryArchitectureSummary: vi.fn().mockResolvedValue(null),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = (await provider.provideCodeLenses(
      fakeDocumentCreate('file', focusUri) as never,
      tokenSource.token as never,
    )) as unknown as Array<{ command: { title: string } }>;
    expect(lenses[0]!.command.title).toBe(
      'Codepol: 1 importer • 1 importee',
    );
  });

  it('rethrows non-superseded queryArchitectureSummary failures (so unexpected metric failures surface)', async () => {
    const { CodepolArchitectureCodeLensProvider } = await import(
      '../extension-vscode/src/codeLensProvider'
    );
    const provider = new CodepolArchitectureCodeLensProvider({
      protocol: {
        queryImpactRadius: vi.fn().mockResolvedValue(baseGraph),
        queryArchitectureSummary: vi.fn().mockRejectedValue(
          new Error('summary crashed'),
        ),
      },
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    await expect(
      provider.provideCodeLenses(
        fakeDocumentCreate('file', focusUri) as never,
        tokenSource.token as never,
      ),
    ).rejects.toThrow('summary crashed');
  });
});

/**
 * Class-boundary tests for `CodepolSymbolCodeLensProvider`.
 *
 * The view-model spec
 * (`tests/extension-vscode.symbol-code-lens-view-models.spec.ts`)
 * covers the pure title/tooltip mapping. This spec covers the
 * provider's contract at its outer edge:
 *
 * - returns `[]` for non-`file:` documents without calling the
 *   protocol
 * - returns `[]` when the protocol throws a `request_superseded`
 *   error (existing readiness convention)
 * - rethrows other errors (so unexpected failures still surface)
 * - emits one `vscode.CodeLens` per item with the correct command
 *   id (`codepol.extension.showCallGraph`) and a
 *   `SymbolCallGraphCommandArgument`-shaped argument
 *
 * `vscode` is mocked at the module boundary — the test only needs
 * `Range`, `CodeLens`, `EventEmitter`, and `CancellationTokenSource`
 * to construct the provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('CodepolSymbolCodeLensProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns no lenses for non-file URIs without consulting the protocol', async () => {
    const { CodepolSymbolCodeLensProvider } = await import(
      '../extension-vscode/src/symbolCodeLensProvider'
    );
    const querySymbolsInFileWithCallCounts = vi.fn();
    const provider = new CodepolSymbolCodeLensProvider({
      protocol: { querySymbolsInFileWithCallCounts },
      showCallGraphCommandId: 'codepol.extension.showCallGraph',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate('untitled', 'untitled:Untitled-1') as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(querySymbolsInFileWithCallCounts).not.toHaveBeenCalled();
  });

  it('returns no lenses when the protocol throws request_superseded (no rethrow)', async () => {
    const { CodepolSymbolCodeLensProvider } = await import(
      '../extension-vscode/src/symbolCodeLensProvider'
    );
    const querySymbolsInFileWithCallCounts = vi
      .fn()
      .mockRejectedValue(requestSupersededErrorCreate());
    const provider = new CodepolSymbolCodeLensProvider({
      protocol: { querySymbolsInFileWithCallCounts },
      showCallGraphCommandId: 'codepol.extension.showCallGraph',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate('file', 'file:///workspace/src/a.ts') as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('rethrows any non-superseded protocol failure so the editor surfaces it', async () => {
    const { CodepolSymbolCodeLensProvider } = await import(
      '../extension-vscode/src/symbolCodeLensProvider'
    );
    const querySymbolsInFileWithCallCounts = vi
      .fn()
      .mockRejectedValue(new Error('protocol crash'));
    const provider = new CodepolSymbolCodeLensProvider({
      protocol: { querySymbolsInFileWithCallCounts },
      showCallGraphCommandId: 'codepol.extension.showCallGraph',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    await expect(
      provider.provideCodeLenses(
        fakeDocumentCreate('file', 'file:///workspace/src/a.ts') as never,
        tokenSource.token as never,
      ),
    ).rejects.toThrow('protocol crash');
  });

  it('returns one CodeLens per item with the showCallGraph command and the SymbolCallGraphCommandArgument shape', async () => {
    const { CodepolSymbolCodeLensProvider } = await import(
      '../extension-vscode/src/symbolCodeLensProvider'
    );
    const querySymbolsInFileWithCallCounts = vi.fn().mockResolvedValue({
      items: [
        {
          symbol: {
            symbolId: 'sym-1',
            name: 'first',
            kind: 'function',
            declarationUri: 'file:///workspace/src/a.ts',
            declarationRange: {
              start: { line: 1, character: 9 },
              end: { line: 1, character: 14 },
            },
          },
          callerCount: 2,
          calleeCount: 1,
        },
        {
          symbol: {
            symbolId: 'sym-2',
            name: 'second',
            kind: 'method',
            declarationUri: 'file:///workspace/src/a.ts',
            declarationRange: {
              start: { line: 8, character: 2 },
              end: { line: 8, character: 8 },
            },
          },
          callerCount: 0,
          calleeCount: 0,
        },
      ],
    });
    const provider = new CodepolSymbolCodeLensProvider({
      protocol: { querySymbolsInFileWithCallCounts },
      showCallGraphCommandId: 'codepol.extension.showCallGraph',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = (await provider.provideCodeLenses(
      fakeDocumentCreate('file', 'file:///workspace/src/a.ts') as never,
      tokenSource.token as never,
    )) as unknown as Array<{
      range: { startLine: number; startCharacter: number };
      command: {
        title: string;
        tooltip?: string;
        command: string;
        arguments?: unknown[];
      };
    }>;

    expect(querySymbolsInFileWithCallCounts).toHaveBeenCalledWith({
      uri: 'file:///workspace/src/a.ts',
    });
    expect(lenses).toHaveLength(2);

    expect(lenses[0]!.range.startLine).toBe(1);
    expect(lenses[0]!.range.startCharacter).toBe(9);
    expect(lenses[0]!.command.command).toBe('codepol.extension.showCallGraph');
    expect(lenses[0]!.command.title).toBe('Codepol: 2 callers \u00b7 1 callee');
    expect(lenses[0]!.command.arguments).toEqual([
      { symbolId: 'sym-1', focusSymbolName: 'first' },
    ]);

    expect(lenses[1]!.range.startLine).toBe(8);
    expect(lenses[1]!.command.title).toBe('Codepol: 0 callers \u00b7 0 callees');
    expect(lenses[1]!.command.arguments).toEqual([
      { symbolId: 'sym-2', focusSymbolName: 'second' },
    ]);
  });

  it('returns no lenses when the protocol returns null (degraded readiness)', async () => {
    const { CodepolSymbolCodeLensProvider } = await import(
      '../extension-vscode/src/symbolCodeLensProvider'
    );
    const querySymbolsInFileWithCallCounts = vi.fn().mockResolvedValue(null);
    const provider = new CodepolSymbolCodeLensProvider({
      protocol: { querySymbolsInFileWithCallCounts },
      showCallGraphCommandId: 'codepol.extension.showCallGraph',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate('file', 'file:///workspace/src/a.ts') as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('skips items whose symbolId is empty (no lens to attach)', async () => {
    const { CodepolSymbolCodeLensProvider } = await import(
      '../extension-vscode/src/symbolCodeLensProvider'
    );
    const querySymbolsInFileWithCallCounts = vi.fn().mockResolvedValue({
      items: [
        {
          symbol: {
            symbolId: '',
            name: 'orphan',
            kind: 'function',
            declarationUri: 'file:///workspace/src/a.ts',
            declarationRange: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 6 },
            },
          },
          callerCount: 0,
          calleeCount: 0,
        },
        {
          symbol: {
            symbolId: 'real',
            name: 'real',
            kind: 'function',
            declarationUri: 'file:///workspace/src/a.ts',
            declarationRange: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 4 },
            },
          },
          callerCount: 1,
          calleeCount: 0,
        },
      ],
    });
    const provider = new CodepolSymbolCodeLensProvider({
      protocol: { querySymbolsInFileWithCallCounts },
      showCallGraphCommandId: 'codepol.extension.showCallGraph',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = (await provider.provideCodeLenses(
      fakeDocumentCreate('file', 'file:///workspace/src/a.ts') as never,
      tokenSource.token as never,
    )) as unknown as Array<{
      command: { arguments?: unknown[] };
    }>;
    expect(lenses).toHaveLength(1);
    expect(lenses[0]!.command.arguments).toEqual([
      { symbolId: 'real', focusSymbolName: 'real' },
    ]);
  });
});

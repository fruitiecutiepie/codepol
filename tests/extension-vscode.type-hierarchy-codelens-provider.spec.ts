/**
 * Class-boundary tests for `CodepolTypeHierarchyCodeLensProvider`.
 *
 * Phase 9.5 / Gap 3 — sibling to
 * `tests/extension-vscode.symbol-code-lens-provider.spec.ts`. The
 * view-model spec
 * (`tests/extension-vscode.type-hierarchy-codelens.spec.ts`) covers
 * the pure title/tooltip mapping. This spec covers the provider's
 * contract at its outer edge:
 *
 * - returns `[]` for non-`file:` documents and non-TypeScript
 *   languages without calling the protocol
 * - the regex declaration scanner matches the documented patterns
 *   (interface, exported interface, type-alias-of-object) and skips
 *   plain type aliases / indented declarations
 * - drops the lens when `querySymbolAtPosition` returns no symbol
 * - drops the lens when the resolved symbol kind is not
 *   `'interface'` or `'type'` (e.g. the cursor landed on a class)
 * - drops the lens when `queryTypeHierarchy` returns no edges
 * - emits one CodeLens per interface declaration with the correct
 *   command id and `TypeHierarchyCodeLensCommandArgument` shape
 * - swallows `request_superseded` and rethrows other errors
 *
 * `vscode` is mocked at the module boundary; the document fake only
 * needs `uri`, `languageId`, `lineCount`, and `lineAt`.
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
  languageId: string;
  lineCount: number;
  lineAt(line: number): { text: string };
};

function fakeDocumentCreate(input: {
  scheme?: string;
  uri?: string;
  languageId?: string;
  lines: string[];
}): FakeDocument {
  const lines = input.lines;
  const scheme = input.scheme ?? 'file';
  const uri = input.uri ?? 'file:///workspace/src/iface.ts';
  return {
    uri: {
      scheme,
      toString: () => uri,
    },
    languageId: input.languageId ?? 'typescript',
    lineCount: lines.length,
    lineAt(line: number) {
      return { text: lines[line] ?? '' };
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

type ProtocolStub = {
  querySymbolAtPosition: ReturnType<typeof vi.fn>;
  queryTypeHierarchy: ReturnType<typeof vi.fn>;
};

function protocolStubCreate(): ProtocolStub {
  return {
    querySymbolAtPosition: vi.fn(),
    queryTypeHierarchy: vi.fn(),
  };
}

function symbolDescriptorCreate(
  kind: 'interface' | 'type' | 'class',
  symbolId: string,
  name: string,
): { symbol: {
  symbolId: string;
  name: string;
  kind: string;
  declarationUri: string;
  declarationRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
} } {
  return {
    symbol: {
      symbolId,
      name,
      kind,
      declarationUri: 'file:///workspace/src/iface.ts',
      declarationRange: {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 13 },
      },
    },
  };
}

function declaredOnlyResultCreate(
  focusSymbolId: string,
  implementerCount: number,
): {
  nodes: never[];
  edges: { fromUri: string; toUri: string }[];
  entryPoints: never[];
  cycles: never[];
} {
  const focusUri = `codepol-symbol://${encodeURIComponent(focusSymbolId)}`;
  const edges: { fromUri: string; toUri: string }[] = [];
  for (let i = 0; i < implementerCount; i += 1) {
    edges.push({
      fromUri: `codepol-symbol://impl-${i}`,
      toUri: focusUri,
    });
  }
  return {
    nodes: [],
    edges,
    entryPoints: [],
    cycles: [],
  };
}

describe('CodepolTypeHierarchyCodeLensProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns no lenses for non-file URIs without consulting the protocol', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({
        scheme: 'untitled',
        lines: ['interface Foo {'],
      }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.querySymbolAtPosition).not.toHaveBeenCalled();
    expect(protocol.queryTypeHierarchy).not.toHaveBeenCalled();
  });

  it('returns no lenses for non-TypeScript documents without consulting the protocol', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({
        languageId: 'python',
        lines: ['interface Foo {'],
      }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.querySymbolAtPosition).not.toHaveBeenCalled();
  });

  it('runs against typescriptreact documents (covers .tsx)', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('interface', 'iface-id', 'IShape'),
    );
    protocol.queryTypeHierarchy.mockResolvedValue(
      declaredOnlyResultCreate('iface-id', 1),
    );
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({
        languageId: 'typescriptreact',
        lines: ['interface IShape {'],
      }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toHaveLength(1);
    expect(protocol.querySymbolAtPosition).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: 'plain interface declaration',
      line: 'interface IShape {',
      expectedChar: 10,
    },
    {
      label: 'exported interface with generics + extends',
      line: 'export interface IShape<T> extends Bar {',
      expectedChar: 17,
    },
    {
      label: 'object-literal type alias',
      line: 'type Handler = {',
      expectedChar: 5,
    },
    {
      label: 'exported object-literal type alias with generics',
      line: 'export type Handler<T> = {',
      expectedChar: 12,
    },
  ])('regex scanner matches: $label', async ({ line, expectedChar }) => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('interface', 'iface-id', 'IShape'),
    );
    protocol.queryTypeHierarchy.mockResolvedValue(
      declaredOnlyResultCreate('iface-id', 1),
    );
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: [line] }) as never,
      tokenSource.token as never,
    );

    expect(protocol.querySymbolAtPosition).toHaveBeenCalledOnce();
    const arg = protocol.querySymbolAtPosition.mock.calls[0]![0] as {
      position: { line: number; character: number };
    };
    expect(arg.position.line).toBe(0);
    expect(arg.position.character).toBe(expectedChar);
  });

  it.each([
    { label: 'plain non-object type alias', line: 'type Alias = number;' },
    { label: 'union type alias', line: 'type Either = string | number;' },
    { label: 'indented interface declaration', line: '  interface Inner {' },
    { label: 'comment containing the keyword', line: '// interface Foo' },
    { label: 'string containing the keyword', line: 'const s = "interface Foo";' },
  ])('regex scanner skips: $label', async ({ line }) => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: [line] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.querySymbolAtPosition).not.toHaveBeenCalled();
  });

  it('drops the lens when querySymbolAtPosition returns no symbol', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue({ symbol: undefined });
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['interface IShape {'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.queryTypeHierarchy).not.toHaveBeenCalled();
  });

  it('drops the lens when the symbol kind is not interface or type', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    // Cursor lands on a class declaration that the regex happened
    // to match (it shouldn't because the regex is keyword-anchored,
    // but defensive: if the LSP returns a different kind, drop).
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('class', 'class-id', 'NotAnInterface'),
    );
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['interface IShape {'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.queryTypeHierarchy).not.toHaveBeenCalled();
  });

  it('drops the lens when queryTypeHierarchy returns null (degraded readiness)', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('interface', 'iface-id', 'IShape'),
    );
    protocol.queryTypeHierarchy.mockResolvedValue(null);
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['interface IShape {'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('drops the lens when the interface has zero implementers across all tiers', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('interface', 'iface-id', 'IShape'),
    );
    protocol.queryTypeHierarchy.mockResolvedValue(
      declaredOnlyResultCreate('iface-id', 0),
    );
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['interface IShape {'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('emits one CodeLens per interface with the showTypeHierarchy command argument', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    // Two interfaces in one file.
    protocol.querySymbolAtPosition
      .mockResolvedValueOnce(
        symbolDescriptorCreate('interface', 'iface-a', 'IShape'),
      )
      .mockResolvedValueOnce(
        symbolDescriptorCreate('interface', 'iface-b', 'IRunner'),
      );
    protocol.queryTypeHierarchy
      .mockResolvedValueOnce(declaredOnlyResultCreate('iface-a', 3))
      .mockResolvedValueOnce(declaredOnlyResultCreate('iface-b', 1));

    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = (await provider.provideCodeLenses(
      fakeDocumentCreate({
        lines: [
          'interface IShape {',
          '}',
          '',
          'interface IRunner {',
          '}',
        ],
      }) as never,
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

    expect(lenses).toHaveLength(2);
    expect(lenses[0]!.range.startLine).toBe(0);
    expect(lenses[0]!.command.command).toBe(
      'codepol.extension.showTypeHierarchy',
    );
    expect(lenses[0]!.command.title).toBe('Codepol: 3 implementers');
    expect(lenses[0]!.command.arguments).toEqual([
      { symbolId: 'iface-a', focusSymbolName: 'IShape' },
    ]);

    expect(lenses[1]!.range.startLine).toBe(3);
    expect(lenses[1]!.command.title).toBe('Codepol: 1 implementer');
    expect(lenses[1]!.command.arguments).toEqual([
      { symbolId: 'iface-b', focusSymbolName: 'IRunner' },
    ]);

    // The provider passed `includeStructural: true` to every
    // hierarchy call so the CodeLens count matches what the panel
    // would render.
    for (const call of protocol.queryTypeHierarchy.mock.calls) {
      expect(call[0]).toMatchObject({
        direction: 'subtypes',
        includeStructural: true,
      });
    }
  });

  it('returns no lenses when querySymbolAtPosition throws request_superseded', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockRejectedValue(
      requestSupersededErrorCreate(),
    );
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['interface IShape {'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('returns no lenses when queryTypeHierarchy throws request_superseded', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('interface', 'iface-id', 'IShape'),
    );
    protocol.queryTypeHierarchy.mockRejectedValue(
      requestSupersededErrorCreate(),
    );
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['interface IShape {'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('rethrows non-superseded protocol failures so the editor surfaces them', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('interface', 'iface-id', 'IShape'),
    );
    protocol.queryTypeHierarchy.mockRejectedValue(new Error('protocol crash'));
    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    await expect(
      provider.provideCodeLenses(
        fakeDocumentCreate({ lines: ['interface IShape {'] }) as never,
        tokenSource.token as never,
      ),
    ).rejects.toThrow('protocol crash');
  });

  it('aborts before issuing the second lens when the token is cancelled mid-loop', async () => {
    const { CodepolTypeHierarchyCodeLensProvider } = await import(
      '../extension-vscode/src/typeHierarchyCodeLensProvider'
    );
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const protocol = protocolStubCreate();
    let resolvedFirst = false;
    protocol.querySymbolAtPosition.mockImplementation(async () => {
      if (!resolvedFirst) {
        resolvedFirst = true;
        return symbolDescriptorCreate('interface', 'iface-a', 'IShape');
      }
      return symbolDescriptorCreate('interface', 'iface-b', 'IRunner');
    });
    protocol.queryTypeHierarchy.mockImplementation(async () => {
      // Simulate cancellation arriving during the first hierarchy
      // lookup. The provider must check the token before issuing
      // the next round-trip and bail.
      tokenSource.cancel();
      return declaredOnlyResultCreate('iface-a', 1);
    });

    const provider = new CodepolTypeHierarchyCodeLensProvider({
      protocol,
      showTypeHierarchyCommandId: 'codepol.extension.showTypeHierarchy',
    });

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({
        lines: ['interface IShape {', '}', '', 'interface IRunner {', '}'],
      }) as never,
      tokenSource.token as never,
    );

    // The first lens completed before the cancel; the second never
    // issued the position-resolve RPC because the cancellation
    // check at the loop top short-circuited it.
    expect(protocol.querySymbolAtPosition).toHaveBeenCalledTimes(1);
    // Provider returns `[]` when cancelled mid-loop — see the
    // `if (token.isCancellationRequested) return [];` guard.
    expect(lenses).toEqual([]);
  });
});

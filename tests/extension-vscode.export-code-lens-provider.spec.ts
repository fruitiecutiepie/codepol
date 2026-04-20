/**
 * Class-boundary tests for `CodepolExportCodeLensProvider`.
 *
 * Phase 5 follow-up — sibling to
 * `tests/extension-vscode.type-hierarchy-codelens-provider.spec.ts`.
 * Covers the provider's contract at its outer edge:
 *
 * - returns `[]` for non-`file:` documents and non-TS/JS languages
 *   without calling the protocol
 * - the regex declaration scanner matches the documented `export`
 *   patterns (function, const, class, interface, type, enum,
 *   namespace, default-async-prefix combinations) and skips re-export
 *   blocks / star re-exports / indented declarations / non-export
 *   lines
 * - drops the lens when `querySymbolAtPosition` returns no symbol
 * - drops the lens when `querySymbolImporterCount` returns zero
 *   importers (so unimported exports stay quiet)
 * - emits one CodeLens per export with the peek command id and
 *   `{ uri, position }` argument shape
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
  const uri = input.uri ?? 'file:///workspace/src/lib.ts';
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
  querySymbolImporterCount: ReturnType<typeof vi.fn>;
};

function protocolStubCreate(): ProtocolStub {
  return {
    querySymbolAtPosition: vi.fn(),
    querySymbolImporterCount: vi.fn(),
  };
}

function symbolDescriptorCreate(
  kind: string,
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
      declarationUri: 'file:///workspace/src/lib.ts',
      declarationRange: {
        start: { line: 0, character: 16 },
        end: { line: 0, character: 22 },
      },
    },
  };
}

describe('CodepolExportCodeLensProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns no lenses for non-file URIs without consulting the protocol', async () => {
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({
        scheme: 'untitled',
        lines: ['export function helper() {}'],
      }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.querySymbolAtPosition).not.toHaveBeenCalled();
    expect(protocol.querySymbolImporterCount).not.toHaveBeenCalled();
  });

  it('returns no lenses for non-TS/JS languages (e.g. Python) without consulting the protocol', async () => {
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({
        languageId: 'python',
        lines: ['export function helper() {}'],
      }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.querySymbolAtPosition).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'export function',
      line: 'export function helper() {}',
      expectedChar: 16,
    },
    {
      label: 'export const',
      line: 'export const value = 42;',
      expectedChar: 13,
    },
    {
      label: 'export class',
      line: 'export class Animal {}',
      expectedChar: 13,
    },
    {
      label: 'export interface',
      line: 'export interface IShape {}',
      expectedChar: 17,
    },
    {
      label: 'export type',
      line: 'export type Handler = () => void;',
      expectedChar: 12,
    },
    {
      label: 'export enum',
      line: 'export enum Status { Open }',
      expectedChar: 12,
    },
    {
      label: 'export namespace',
      line: 'export namespace Util {}',
      expectedChar: 17,
    },
    {
      label: 'export async function',
      line: 'export async function fetchData() {}',
      expectedChar: 22,
    },
    {
      label: 'export default function',
      line: 'export default function helper() {}',
      expectedChar: 24,
    },
    {
      label: 'export abstract class',
      line: 'export abstract class Shape {}',
      expectedChar: 22,
    },
  ])('regex scanner matches: $label', async ({ line, expectedChar }) => {
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('function', 'sym-id', 'helper'),
    );
    protocol.querySymbolImporterCount.mockResolvedValue({
      symbolId: 'sym-id',
      importerCount: 1,
      importerUris: ['file:///workspace/src/consumer.ts'],
    });
    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
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
    { label: 'indented export', line: '  export function inner() {}' },
    { label: 'bare re-export block', line: "export { helper } from './a';" },
    { label: 'star re-export', line: "export * from './b';" },
    { label: 'non-export declaration', line: 'function helper() {}' },
    { label: 'comment with export keyword', line: '// export function helper' },
  ])('regex scanner skips: $label', async ({ line }) => {
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
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
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue({ symbol: undefined });
    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['export function helper() {}'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.querySymbolImporterCount).not.toHaveBeenCalled();
  });

  it('drops the lens when querySymbolImporterCount reports zero importers', async () => {
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockResolvedValue(
      symbolDescriptorCreate('function', 'sym-id', 'unused'),
    );
    protocol.querySymbolImporterCount.mockResolvedValue({
      symbolId: 'sym-id',
      importerCount: 0,
      importerUris: [],
    });
    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['export function unused() {}'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
  });

  it('emits one CodeLens per export with the peek command and { uri, position } argument', async () => {
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition
      .mockResolvedValueOnce(
        symbolDescriptorCreate('function', 'sym-helper', 'helper'),
      )
      .mockResolvedValueOnce(
        symbolDescriptorCreate('class', 'sym-shape', 'Shape'),
      );
    protocol.querySymbolImporterCount
      .mockResolvedValueOnce({
        symbolId: 'sym-helper',
        importerCount: 3,
        importerUris: [
          'file:///a.ts',
          'file:///b.ts',
          'file:///c.ts',
        ],
      })
      .mockResolvedValueOnce({
        symbolId: 'sym-shape',
        importerCount: 1,
        importerUris: ['file:///d.ts'],
      });

    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = (await provider.provideCodeLenses(
      fakeDocumentCreate({
        lines: [
          'export function helper() {}',
          '',
          'export class Shape {}',
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
    expect(lenses[0]!.command.command).toBe('codepol.architecture.peek');
    expect(lenses[0]!.command.title).toBe('Codepol: 3 importers');
    expect(lenses[0]!.command.arguments).toEqual([
      {
        uri: 'file:///workspace/src/lib.ts',
        position: { line: 0, character: 16 },
      },
    ]);

    expect(lenses[1]!.range.startLine).toBe(2);
    expect(lenses[1]!.command.title).toBe('Codepol: 1 importer');
    expect(lenses[1]!.command.arguments).toEqual([
      {
        uri: 'file:///workspace/src/lib.ts',
        position: { line: 2, character: 13 },
      },
    ]);
  });

  it('returns no lenses when querySymbolAtPosition throws request_superseded', async () => {
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockRejectedValue(
      requestSupersededErrorCreate(),
    );
    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    const lenses = await provider.provideCodeLenses(
      fakeDocumentCreate({ lines: ['export function helper() {}'] }) as never,
      tokenSource.token as never,
    );
    expect(lenses).toEqual([]);
    expect(protocol.querySymbolImporterCount).not.toHaveBeenCalled();
  });

  it('rethrows non-superseded errors from querySymbolAtPosition', async () => {
    const { CodepolExportCodeLensProvider } = await import(
      '../extension-vscode/src/exportCodeLensProvider'
    );
    const protocol = protocolStubCreate();
    protocol.querySymbolAtPosition.mockRejectedValue(new Error('boom'));
    const provider = new CodepolExportCodeLensProvider({
      protocol,
      peekCommandId: 'codepol.architecture.peek',
    });
    const tokenSource = new (await import('vscode')).CancellationTokenSource();

    await expect(
      provider.provideCodeLenses(
        fakeDocumentCreate({ lines: ['export function helper() {}'] }) as never,
        tokenSource.token as never,
      ),
    ).rejects.toThrow('boom');
  });
});

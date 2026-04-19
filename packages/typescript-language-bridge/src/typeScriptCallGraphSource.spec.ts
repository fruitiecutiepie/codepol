/**
 * Contract tests for the TypeScript {@link TypeAwareCallGraphSource}
 * binding (Phase 9.2 / Gap 1).
 *
 * The bridge speaks LSP via a host-supplied transport — these tests
 * stub the transport in-memory so the bridge's contract (request
 * shape, callKind classification, symbol-id translation) is exercised
 * without spawning `tsserver`. End-to-end coverage against the real
 * language server lives in the extension test pack.
 */
import { describe, expect, it } from 'vitest';
import {
  typeScriptCallGraphSourceCreate,
  type LspSymbolLocation,
  type LspTransport,
  type TypeScriptCallGraphSourceOptions,
} from './index';

type RecordedRequest = { method: string; params: unknown };

function transportFromMap(handlers: {
  [method: string]: (params: unknown) => unknown;
}): { transport: LspTransport; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const transport: LspTransport = {
    async request<T>(method: string, params: unknown): Promise<T> {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) {
        throw new Error(`unexpected LSP method: ${method}`);
      }
      return handler(params) as T;
    },
  };
  return { transport, calls };
}

const FAKE_LOCATION: LspSymbolLocation = {
  uri: 'file:///fake.ts',
  line: 0,
  character: 6,
};

describe('typeScriptCallGraphSourceCreate', () => {
  it('returns no edges when the symbol cannot be located', async () => {
    const { transport } = transportFromMap({});
    const options: TypeScriptCallGraphSourceOptions = {
      transport,
      symbolLocate: () => undefined,
      symbolIdResolve: () => undefined,
    };
    const source = typeScriptCallGraphSourceCreate(options);
    expect(await source.typeAwareCallersGet!('symbol-x')).toEqual([]);
    expect(await source.typeAwareCalleesGet!('symbol-x')).toEqual([]);
  });

  it('issues prepareCallHierarchy then incomingCalls and translates back to symbol ids', async () => {
    const { transport, calls } = transportFromMap({
      'textDocument/prepareCallHierarchy': () => [
        {
          name: 'callee',
          kind: 12,
          uri: 'file:///fake.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
        },
      ],
      'callHierarchy/incomingCalls': () => [
        {
          from: {
            name: 'caller',
            kind: 12,
            uri: 'file:///fake.ts',
            range: { start: { line: 5, character: 0 }, end: { line: 5, character: 30 } },
            selectionRange: {
              start: { line: 5, character: 9 },
              end: { line: 5, character: 15 },
            },
          },
          fromRanges: [
            { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
          ],
        },
      ],
    });

    const source = typeScriptCallGraphSourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: (loc) =>
        loc.line === 5 && loc.character === 9 ? 'caller-id' : undefined,
    });

    const edges = await source.typeAwareCallersGet!('callee-id');
    expect(edges).toHaveLength(1);
    expect(edges[0].callerSymbolId).toBe('caller-id');
    expect(edges[0].calleeSymbolId).toBe('callee-id');
    expect(edges[0].callKind).toBe('direct');
    expect(calls.map((c) => c.method)).toEqual([
      'textDocument/prepareCallHierarchy',
      'callHierarchy/incomingCalls',
    ]);
  });

  it('classifies dynamic-dispatch hints from the language server detail field', async () => {
    const { transport } = transportFromMap({
      'textDocument/prepareCallHierarchy': () => [
        {
          name: 'callee',
          kind: 12,
          uri: 'file:///fake.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
        },
      ],
      'callHierarchy/outgoingCalls': () => [
        {
          to: {
            name: 'someMethod',
            kind: 6,
            uri: 'file:///fake.ts',
            range: { start: { line: 9, character: 0 }, end: { line: 9, character: 30 } },
            selectionRange: {
              start: { line: 9, character: 4 },
              end: { line: 9, character: 14 },
            },
            detail: 'dynamic dispatch via interface',
          },
          fromRanges: [],
        },
      ],
    });

    const source = typeScriptCallGraphSourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: (loc) =>
        loc.line === 9 && loc.character === 4 ? 'callee-id' : undefined,
    });

    const edges = await source.typeAwareCalleesGet!('caller-id');
    expect(edges).toHaveLength(1);
    expect(edges[0].callKind).toBe('dynamic-dispatch');
  });

  it('drops edges whose endpoints the host cannot translate back to a symbol id', async () => {
    const { transport } = transportFromMap({
      'textDocument/prepareCallHierarchy': () => [
        {
          name: 'callee',
          kind: 12,
          uri: 'file:///fake.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
        },
      ],
      'callHierarchy/incomingCalls': () => [
        {
          from: {
            name: 'caller-without-symbol-id',
            kind: 12,
            uri: 'file:///external.ts',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          },
          fromRanges: [],
        },
      ],
    });

    const source = typeScriptCallGraphSourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      // Refuse to resolve any LSP location → all edges should drop.
      symbolIdResolve: () => undefined,
    });

    expect(await source.typeAwareCallersGet!('callee-id')).toEqual([]);
  });
});

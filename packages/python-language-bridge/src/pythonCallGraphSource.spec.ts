/**
 * Contract tests for the Python {@link TypeAwareCallGraphSource}
 * binding.
 *
 * Mirrors the TypeScript bridge spec one-for-one — the LSP payload
 * shape is language-agnostic, so the only meaningful divergence is
 * the Python-flavored `callKind` heuristics (`abstract`, `protocol`,
 * `overload` ⇒ `'dynamic-dispatch'`).
 *
 * The bridge speaks LSP via a host-supplied transport — these tests
 * stub the transport in-memory so the bridge's contract (request
 * shape, callKind classification, symbol-id translation) is exercised
 * without spawning `pyright` / `pylance`. End-to-end coverage against
 * the real language server lives in the editor extension test pack.
 */
import { describe, expect, it } from 'vitest';
import {
  pythonCallGraphSourceCreate,
  type LspSymbolLocation,
  type LspTransport,
  type PythonCallGraphSourceOptions,
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
  uri: 'file:///fake.py',
  line: 0,
  character: 4,
};

describe('pythonCallGraphSourceCreate', () => {
  it('returns no edges when the symbol cannot be located', async () => {
    const { transport } = transportFromMap({});
    const options: PythonCallGraphSourceOptions = {
      transport,
      symbolLocate: () => undefined,
      symbolIdResolve: () => undefined,
    };
    const source = pythonCallGraphSourceCreate(options);
    expect(await source.typeAwareCallersGet!('symbol-x')).toEqual([]);
    expect(await source.typeAwareCalleesGet!('symbol-x')).toEqual([]);
  });

  it('issues prepareCallHierarchy then incomingCalls and translates back to symbol ids', async () => {
    const { transport, calls } = transportFromMap({
      'textDocument/prepareCallHierarchy': () => [
        {
          name: 'callee',
          kind: 12,
          uri: 'file:///fake.py',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 14 } },
          selectionRange: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 10 },
          },
        },
      ],
      'callHierarchy/incomingCalls': () => [
        {
          from: {
            name: 'caller',
            kind: 12,
            uri: 'file:///fake.py',
            range: { start: { line: 5, character: 0 }, end: { line: 5, character: 30 } },
            selectionRange: {
              start: { line: 5, character: 4 },
              end: { line: 5, character: 10 },
            },
          },
          fromRanges: [
            { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
          ],
        },
      ],
    });

    const source = pythonCallGraphSourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: (loc) =>
        loc.line === 5 && loc.character === 4 ? 'caller-id' : undefined,
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

  it('classifies abstract / protocol / overload markers as dynamic-dispatch', async () => {
    // Pyright surfaces these markers in `CallHierarchyItem.detail` for
    // declarations that cannot be resolved to a single implementation
    // at the call site. The bridge collapses all three into
    // `'dynamic-dispatch'` because the call-graph kind axis only
    // distinguishes "single impl known" vs "multiple possible impls".
    const cases: Array<{ detail: string; expected: string }> = [
      { detail: 'abstract method', expected: 'dynamic-dispatch' },
      { detail: 'Protocol member', expected: 'dynamic-dispatch' },
      { detail: '@overload', expected: 'dynamic-dispatch' },
      { detail: 'callback registered via decorator', expected: 'higher-order' },
      { detail: 'plain function', expected: 'direct' },
      { detail: '', expected: 'direct' },
    ];

    for (const { detail, expected } of cases) {
      const { transport } = transportFromMap({
        'textDocument/prepareCallHierarchy': () => [
          {
            name: 'callee',
            kind: 12,
            uri: 'file:///fake.py',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 14 } },
            selectionRange: {
              start: { line: 0, character: 4 },
              end: { line: 0, character: 10 },
            },
          },
        ],
        'callHierarchy/outgoingCalls': () => [
          {
            to: {
              name: 'someMethod',
              kind: 6,
              uri: 'file:///fake.py',
              range: { start: { line: 9, character: 0 }, end: { line: 9, character: 30 } },
              selectionRange: {
                start: { line: 9, character: 4 },
                end: { line: 9, character: 14 },
              },
              detail,
            },
            fromRanges: [],
          },
        ],
      });

      const source = pythonCallGraphSourceCreate({
        transport,
        symbolLocate: () => FAKE_LOCATION,
        symbolIdResolve: (loc) =>
          loc.line === 9 && loc.character === 4 ? 'callee-id' : undefined,
      });

      const edges = await source.typeAwareCalleesGet!('caller-id');
      expect(edges).toHaveLength(1);
      expect(edges[0].callKind).toBe(expected);
    }
  });

  it('drops edges whose endpoints the host cannot translate back to a symbol id', async () => {
    // Pyright reports calls into `site-packages` and the standard
    // library, neither of which the codepol index sees. The bridge
    // must skip those rather than fabricate symbol ids.
    const { transport } = transportFromMap({
      'textDocument/prepareCallHierarchy': () => [
        {
          name: 'callee',
          kind: 12,
          uri: 'file:///fake.py',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 14 } },
          selectionRange: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 10 },
          },
        },
      ],
      'callHierarchy/incomingCalls': () => [
        {
          from: {
            name: 'caller-without-symbol-id',
            kind: 12,
            uri: 'file:///site-packages/external.py',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            selectionRange: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 10 },
            },
          },
          fromRanges: [],
        },
      ],
    });

    const source = pythonCallGraphSourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: () => undefined,
    });

    expect(await source.typeAwareCallersGet!('callee-id')).toEqual([]);
  });
});

/**
 * Contract tests for the Python {@link TypeAwareTypeHierarchySource}
 * binding (Phase 9.5 / Gap 3).
 *
 * Mirrors the TypeScript bridge spec against an in-memory fake
 * transport so the binding contract (request shape, symbol-id
 * translation, kind filtering, `LocationLink` handling) is exercised
 * without spawning `pyright` / `pylance`.
 */
import { describe, expect, it } from 'vitest';
import {
  pythonTypeHierarchySourceCreate,
  type LspSymbolLocation,
  type LspTransport,
  type PythonTypeHierarchySourceOptions,
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
  character: 6,
};

describe('pythonTypeHierarchySourceCreate', () => {
  it('returns no edges when the symbol cannot be located', async () => {
    const { transport } = transportFromMap({});
    const options: PythonTypeHierarchySourceOptions = {
      transport,
      symbolLocate: () => undefined,
      symbolIdResolve: () => undefined,
    };
    const source = pythonTypeHierarchySourceCreate(options);
    expect(await source.typeAwareImplementersGet!('protocol-id')).toEqual([]);
    expect(await source.typeAwareSupertypesGet!('class-id')).toEqual([]);
  });

  it('issues textDocument/implementation and returns edges tagged implements', async () => {
    const { transport, calls } = transportFromMap({
      'textDocument/implementation': () => [
        {
          uri: 'file:///impl.py',
          range: {
            start: { line: 5, character: 6 },
            end: { line: 5, character: 9 },
          },
        },
      ],
    });
    const source = pythonTypeHierarchySourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: (loc) =>
        loc.line === 5 && loc.character === 6 ? 'impl-id' : undefined,
    });
    const edges = await source.typeAwareImplementersGet!('protocol-id');
    expect(edges).toEqual([
      {
        subtypeSymbolId: 'impl-id',
        supertypeSymbolId: 'protocol-id',
        relationKind: 'implements',
      },
    ]);
    expect(calls.map((c) => c.method)).toEqual(['textDocument/implementation']);
  });

  it('drops typeDefinition results that the kind resolver rejects', async () => {
    const { transport } = transportFromMap({
      'textDocument/typeDefinition': () => [
        {
          uri: 'file:///value.py',
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 7 } },
        },
        {
          uri: 'file:///protocol.py',
          range: { start: { line: 3, character: 4 }, end: { line: 3, character: 12 } },
        },
      ],
    });
    const source = pythonTypeHierarchySourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: (loc) => {
        if (loc.line === 1 && loc.character === 2) return 'value-only';
        if (loc.line === 3 && loc.character === 4) return 'protocol-only';
        return undefined;
      },
      symbolKindResolve: (id) => {
        if (id === 'value-only') return 'other';
        if (id === 'protocol-only') return 'interface';
        return undefined;
      },
    });
    const edges = await source.typeAwareSupertypesGet!('impl-id');
    expect(edges).toEqual([
      {
        subtypeSymbolId: 'impl-id',
        supertypeSymbolId: 'protocol-only',
        relationKind: 'implements',
      },
    ]);
  });

  it('resolves LocationLink results via targetSelectionRange', async () => {
    const { transport } = transportFromMap({
      'textDocument/typeDefinition': () => ({
        targetUri: 'file:///base.py',
        targetRange: {
          start: { line: 7, character: 0 },
          end: { line: 8, character: 0 },
        },
        targetSelectionRange: {
          start: { line: 7, character: 6 },
          end: { line: 7, character: 10 },
        },
      }),
    });
    const source = pythonTypeHierarchySourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: (loc) =>
        loc.line === 7 && loc.character === 6 ? 'base-class-id' : undefined,
      symbolKindResolve: (id) => (id === 'base-class-id' ? 'class' : undefined),
    });
    const edges = await source.typeAwareSupertypesGet!('derived-id');
    expect(edges).toEqual([
      {
        subtypeSymbolId: 'derived-id',
        supertypeSymbolId: 'base-class-id',
        relationKind: 'extends',
      },
    ]);
  });
});

/**
 * Contract tests for the TypeScript {@link TypeAwareTypeHierarchySource}
 * binding (Phase 9.5 / Gap 3).
 *
 * Stubs the LSP transport in-memory so the bridge contract (request
 * shape, symbol-id translation, kind filtering) is exercised without
 * spawning `tsserver`. End-to-end coverage against the real language
 * server lives in the extension test pack.
 */
import { describe, expect, it } from 'vitest';
import {
  typeScriptTypeHierarchySourceCreate,
  type LspSymbolLocation,
  type LspTransport,
  type TypeScriptTypeHierarchySourceOptions,
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

describe('typeScriptTypeHierarchySourceCreate', () => {
  it('returns no edges when the symbol cannot be located', async () => {
    const { transport } = transportFromMap({});
    const options: TypeScriptTypeHierarchySourceOptions = {
      transport,
      symbolLocate: () => undefined,
      symbolIdResolve: () => undefined,
    };
    const source = typeScriptTypeHierarchySourceCreate(options);
    expect(await source.typeAwareImplementersGet!('iface')).toEqual([]);
    expect(await source.typeAwareSupertypesGet!('class')).toEqual([]);
  });

  it('issues textDocument/implementation and returns edges tagged implements', async () => {
    const { transport, calls } = transportFromMap({
      'textDocument/implementation': () => [
        {
          uri: 'file:///impl.ts',
          range: {
            start: { line: 5, character: 6 },
            end: { line: 5, character: 12 },
          },
        },
      ],
    });
    const source = typeScriptTypeHierarchySourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: (loc) =>
        loc.line === 5 && loc.character === 6 ? 'class-id' : undefined,
    });
    const edges = await source.typeAwareImplementersGet!('iface-id');
    expect(edges).toEqual([
      { subtypeSymbolId: 'class-id', supertypeSymbolId: 'iface-id', relationKind: 'implements' },
    ]);
    expect(calls.map((c) => c.method)).toEqual(['textDocument/implementation']);
  });

  it('drops typeDefinition results that the kind resolver rejects', async () => {
    const { transport } = transportFromMap({
      'textDocument/typeDefinition': () => [
        {
          uri: 'file:///parent.ts',
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
        },
        {
          uri: 'file:///iface.ts',
          range: { start: { line: 3, character: 4 }, end: { line: 3, character: 10 } },
        },
      ],
    });
    const source = typeScriptTypeHierarchySourceCreate({
      transport,
      symbolLocate: () => FAKE_LOCATION,
      symbolIdResolve: (loc) => {
        if (loc.line === 1 && loc.character === 2) return 'value-only';
        if (loc.line === 3 && loc.character === 4) return 'iface-only';
        return undefined;
      },
      symbolKindResolve: (id) => {
        if (id === 'value-only') return 'other';
        if (id === 'iface-only') return 'interface';
        return undefined;
      },
    });
    const edges = await source.typeAwareSupertypesGet!('child-id');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({
      subtypeSymbolId: 'child-id',
      supertypeSymbolId: 'iface-only',
      relationKind: 'implements',
    });
  });
});

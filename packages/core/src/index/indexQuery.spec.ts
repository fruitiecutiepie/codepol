import { describe, it, expect } from 'vitest';
import { indexStoreNew } from './indexStore';
import { projectIndexCreate } from './indexQuery';
import {
  SymbolFlags,
  type IndexCapabilities,
  type ReferencesRelation,
  type CallsRelation,
  type ExportsRelation,
  type ImportBindingRelation,
  type TypeRelation,
  type FlowGraph,
} from './indexTypes';
import {
  byteRangeGet,
  scopeRecordNew,
  symbolRecordNew,
  fileIndexDeltaNew,
} from './testHelpers';

const defaultCapabilities: IndexCapabilities = {
  crossFileResolution: true,
  callGraph: 'heuristic',
  controlFlowGraph: false,
  supportedLanguages: ['typescript'],
};

// ============================================================================
// Tests
// ============================================================================

describe('ProjectIndex', () => {
  describe('symbol queries', () => {
    it('symbolsGet() returns all symbols across files', () => {
      const store = indexStoreNew();
      const fileA = '/src/a.ts';
      const fileB = '/src/b.ts';
      const scopeA = scopeRecordNew('scope-a', fileA);
      const scopeB = scopeRecordNew('scope-b', fileB);
      const sym1 = symbolRecordNew('sym-1', 'foo', fileA, scopeA.id);
      const sym2 = symbolRecordNew('sym-2', 'bar', fileA, scopeA.id, 'variable');
      const sym3 = symbolRecordNew('sym-3', 'baz', fileB, scopeB.id, 'const');

      store.filePut(fileIndexDeltaNew({ file: fileA, symbols: [sym1, sym2], scopes: [scopeA] }));
      store.filePut(fileIndexDeltaNew({ file: fileB, symbols: [sym3], scopes: [scopeB] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const all = idx.symbolsGet();
      expect(all).toHaveLength(3);
      expect(all.map(s => s.name).sort()).toEqual(['bar', 'baz', 'foo']);
    });

    it('symbolGet(id) returns the symbol or undefined', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-1', 'foo', file, scope.id);

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.symbolGet('sym-1')).toBeDefined();
      expect(idx.symbolGet('sym-1')!.name).toBe('foo');
      expect(idx.symbolGet('nonexistent')).toBeUndefined();
    });

    it('symbolsInFileGet(file) returns only symbols from that file', () => {
      const store = indexStoreNew();
      const fileA = '/src/a.ts';
      const fileB = '/src/b.ts';
      const scopeA = scopeRecordNew('scope-a', fileA);
      const scopeB = scopeRecordNew('scope-b', fileB);
      const sym1 = symbolRecordNew('sym-1', 'foo', fileA, scopeA.id);
      const sym2 = symbolRecordNew('sym-2', 'bar', fileB, scopeB.id);

      store.filePut(fileIndexDeltaNew({ file: fileA, symbols: [sym1], scopes: [scopeA] }));
      store.filePut(fileIndexDeltaNew({ file: fileB, symbols: [sym2], scopes: [scopeB] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const inA = idx.symbolsInFileGet(fileA);
      expect(inA).toHaveLength(1);
      expect(inA[0].name).toBe('foo');
    });

    it('symbolsGetByName(name) returns matching symbols across files', () => {
      const store = indexStoreNew();
      const fileA = '/src/a.ts';
      const fileB = '/src/b.ts';
      const scopeA = scopeRecordNew('scope-a', fileA);
      const scopeB = scopeRecordNew('scope-b', fileB);
      const sym1 = symbolRecordNew('sym-1', 'helper', fileA, scopeA.id);
      const sym2 = symbolRecordNew('sym-2', 'helper', fileB, scopeB.id, 'variable');
      const sym3 = symbolRecordNew('sym-3', 'other', fileA, scopeA.id, 'const');

      store.filePut(fileIndexDeltaNew({ file: fileA, symbols: [sym1, sym3], scopes: [scopeA] }));
      store.filePut(fileIndexDeltaNew({ file: fileB, symbols: [sym2], scopes: [scopeB] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const helpers = idx.symbolsGetByName('helper');
      expect(helpers).toHaveLength(2);
      expect(helpers.map(s => s.file).sort()).toEqual([fileA, fileB]);
    });
  });

  describe('export queries', () => {
    it('exportedSymbolsGet() filters by Exported flag', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const exported = symbolRecordNew('sym-exp', 'pubFn', file, scope.id, 'function', SymbolFlags.Exported);
      const internal = symbolRecordNew('sym-int', 'privFn', file, scope.id, 'function', SymbolFlags.None);
      const alsoExported = symbolRecordNew('sym-exp2', 'PubClass', file, scope.id, 'class', SymbolFlags.Exported);

      store.filePut(fileIndexDeltaNew({ file, symbols: [exported, internal, alsoExported], scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const result = idx.exportedSymbolsGet({ file });
      expect(result).toHaveLength(2);
      expect(result.map(s => s.name).sort()).toEqual(['PubClass', 'pubFn']);
    });

    it('exportersGet(symbolName) returns exported symbols with that name', () => {
      const store = indexStoreNew();
      const fileA = '/src/a.ts';
      const fileB = '/src/b.ts';
      const scopeA = scopeRecordNew('scope-a', fileA);
      const scopeB = scopeRecordNew('scope-b', fileB);
      const expA = symbolRecordNew('sym-a', 'Config', fileA, scopeA.id, 'type', SymbolFlags.Exported);
      const expB = symbolRecordNew('sym-b', 'Config', fileB, scopeB.id, 'interface', SymbolFlags.Exported);
      const notExported = symbolRecordNew('sym-c', 'Config', fileA, scopeA.id, 'variable', SymbolFlags.None);

      store.filePut(fileIndexDeltaNew({ file: fileA, symbols: [expA, notExported], scopes: [scopeA] }));
      store.filePut(fileIndexDeltaNew({ file: fileB, symbols: [expB], scopes: [scopeB] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const exporters = idx.exportersGet('Config');
      expect(exporters).toHaveLength(2);
      expect(exporters.every(s => (s.flags & SymbolFlags.Exported) !== 0)).toBe(true);
    });

    it('exportLocationsGet(symbolId) returns file and exported name', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-a', 'doWork', file, scope.id);
      const exp: ExportsRelation = {
        kind: 'Exports',
        symbolId: sym.id,
        exportedName: 'doWork',
        isDefault: false,
        byteRange: byteRangeGet(0, 30),
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [exp] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const locs = idx.exportLocationsGet('sym-a');
      expect(locs).toHaveLength(1);
      expect(locs[0]).toEqual({ file: '/src/a.ts', exportedName: 'doWork' });
    });
  });

  describe('reference queries', () => {
    it('referencesInFileGet(file) returns references in that file', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-target', 'target', file, scope.id);
      const ref: ReferencesRelation = {
        kind: 'References',
        scopeId: scope.id,
        name: 'target',
        byteRange: byteRangeGet(60, 66),
        resolvedSymbolId: sym.id,
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [ref] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const refs = idx.referencesInFileGet(file);
      expect(refs).toHaveLength(1);
      expect(refs[0].name).toBe('target');
      expect(refs[0].resolvedSymbolId).toBe('sym-target');
    });
  });

  describe('call graph queries', () => {
    // Layout for callersGet:
    //   file scope (scope-file, kind=file, range 0..500)
    //     callerFn symbol (sym-caller, kind=function, scopeId=scope-file, range 0..200)
    //       fnBody scope (scope-fn, kind=function, parent=scope-file, range 10..190)
    //         Calls relation in scope-fn, resolvedSymbolId=sym-callee
    //   callee symbol (sym-callee) in same or different file
    it('callersGet(symbolId) resolves caller function symbols', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';

      const fileScope = scopeRecordNew('scope-file', file, 'file', undefined, byteRangeGet(0, 500));
      const fnBodyScope = scopeRecordNew('scope-fn', file, 'function', fileScope.id, byteRangeGet(10, 190));
      const callerSym = symbolRecordNew('sym-caller', 'doStuff', file, fileScope.id, 'function', SymbolFlags.None, byteRangeGet(0, 200));
      const calleeSym = symbolRecordNew('sym-callee', 'helper', file, fileScope.id, 'function', SymbolFlags.None, byteRangeGet(300, 400));

      const call: CallsRelation = {
        kind: 'Calls',
        scopeId: fnBodyScope.id,
        calleeName: 'helper',
        byteRange: byteRangeGet(50, 56),
        resolvedSymbolId: calleeSym.id,
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [callerSym, calleeSym],
        scopes: [fileScope, fnBodyScope],
        relations: [call],
      }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const callers = idx.callersGet('sym-callee');
      expect(callers).toHaveLength(1);
      expect(callers[0]).toBe('sym-caller');
    });

    // Layout for calleesGet:
    //   file scope (range 0..500)
    //     callerFn symbol (kind=function, range 0..200)
    //       fnBody scope (kind=function, range 10..190) — within caller symbol range
    //         Calls relation with resolvedSymbolId=sym-callee
    it('calleesGet(symbolId) returns callee symbol IDs', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';

      const fileScope = scopeRecordNew('scope-file', file, 'file', undefined, byteRangeGet(0, 500));
      const fnBodyScope = scopeRecordNew('scope-fn', file, 'function', fileScope.id, byteRangeGet(10, 190));
      const callerSym = symbolRecordNew('sym-caller', 'doStuff', file, fileScope.id, 'function', SymbolFlags.None, byteRangeGet(0, 200));
      const calleeSym = symbolRecordNew('sym-callee', 'helper', file, fileScope.id, 'function', SymbolFlags.None, byteRangeGet(300, 400));

      const call: CallsRelation = {
        kind: 'Calls',
        scopeId: fnBodyScope.id,
        calleeName: 'helper',
        byteRange: byteRangeGet(50, 56),
        resolvedSymbolId: calleeSym.id,
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [callerSym, calleeSym],
        scopes: [fileScope, fnBodyScope],
        relations: [call],
      }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const callees = idx.calleesGet('sym-caller');
      expect(callees).toHaveLength(1);
      expect(callees[0]).toBe('sym-callee');
    });

    it('calleesGet returns empty for non-function symbols', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-var', 'count', file, scope.id, 'variable');

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.calleesGet('sym-var')).toEqual([]);
    });
  });

  describe('scope queries', () => {
    it('scopesInFileGet(file) returns all scopes for the file', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const fileScope = scopeRecordNew('scope-file', file, 'file');
      const fnScope = scopeRecordNew('scope-fn', file, 'function', fileScope.id);
      const blockScope = scopeRecordNew('scope-block', file, 'block', fnScope.id);

      store.filePut(fileIndexDeltaNew({ file, scopes: [fileScope, fnScope, blockScope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const scopes = idx.scopesInFileGet(file);
      expect(scopes).toHaveLength(3);
      expect(scopes.map(s => s.kind).sort()).toEqual(['block', 'file', 'function']);
    });
  });

  describe('import/export queries', () => {
    it('importResolve resolves named import by specifier and name', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const localSym = symbolRecordNew('sym-local', 'utils', file, scope.id, 'variable');
      const binding: ImportBindingRelation = {
        kind: 'ImportBinding',
        localSymbolId: localSym.id,
        importedName: 'utils',
        moduleSpec: './utils',
        isDefault: false,
        isNamespace: false,
        resolvedExportId: 'sym-remote-utils',
        byteRange: byteRangeGet(0, 30),
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [localSym], scopes: [scope], relations: [binding] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.importResolve(file, './utils', 'utils')).toBe('sym-remote-utils');
    });

    it('importResolve resolves default import', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const localSym = symbolRecordNew('sym-local', 'MyComp', file, scope.id, 'variable');
      const binding: ImportBindingRelation = {
        kind: 'ImportBinding',
        localSymbolId: localSym.id,
        importedName: 'default',
        moduleSpec: './MyComp',
        isDefault: true,
        isNamespace: false,
        resolvedExportId: 'sym-remote-comp',
        byteRange: byteRangeGet(0, 30),
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [localSym], scopes: [scope], relations: [binding] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.importResolve(file, './MyComp', 'default')).toBe('sym-remote-comp');
    });

    it('importResolve returns undefined for unresolved specifier', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);

      store.filePut(fileIndexDeltaNew({ file, scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.importResolve(file, './nonexistent', 'foo')).toBeUndefined();
    });
  });

  describe('type relation queries', () => {
    it('typeRelationsGet(symbolId) returns extends/implements for a symbol', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const classSym = symbolRecordNew('sym-class', 'Dog', file, scope.id, 'class');
      const parentSym = symbolRecordNew('sym-parent', 'Animal', file, scope.id, 'class');
      const ifaceSym = symbolRecordNew('sym-iface', 'IMovable', file, scope.id, 'interface');

      const extendsRel: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: classSym.id,
        targetName: 'Animal',
        relationKind: 'extends',
        byteRange: byteRangeGet(10, 16),
        resolvedTargetId: parentSym.id,
      };
      const implementsRel: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: classSym.id,
        targetName: 'IMovable',
        relationKind: 'implements',
        byteRange: byteRangeGet(20, 28),
        resolvedTargetId: ifaceSym.id,
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [classSym, parentSym, ifaceSym],
        scopes: [scope],
        relations: [extendsRel, implementsRel],
      }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const rels = idx.typeRelationsGet(classSym.id);
      expect(rels).toHaveLength(2);
      expect(rels.find(r => r.relationKind === 'extends')?.targetName).toBe('Animal');
      expect(rels.find(r => r.relationKind === 'implements')?.targetName).toBe('IMovable');
    });

    it('subTypesGet(symbolId) returns children that extend/implement', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const parentSym = symbolRecordNew('sym-parent', 'Base', file, scope.id, 'class');
      const child1 = symbolRecordNew('sym-child1', 'DerivedA', file, scope.id, 'class');
      const child2 = symbolRecordNew('sym-child2', 'DerivedB', file, scope.id, 'class');

      const rel1: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: child1.id,
        targetName: 'Base',
        relationKind: 'extends',
        byteRange: byteRangeGet(50, 54),
        resolvedTargetId: parentSym.id,
      };
      const rel2: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: child2.id,
        targetName: 'Base',
        relationKind: 'extends',
        byteRange: byteRangeGet(100, 104),
        resolvedTargetId: parentSym.id,
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [parentSym, child1, child2],
        scopes: [scope],
        relations: [rel1, rel2],
      }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const subs = idx.subTypesGet(parentSym.id);
      expect(subs).toHaveLength(2);
      expect(subs.map(r => r.symbolId).sort()).toEqual([child1.id, child2.id].sort());
    });

    it('typeRelationsInFileGet(file) returns all type relations in a file', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym1 = symbolRecordNew('sym-1', 'Foo', file, scope.id, 'class');
      const sym2 = symbolRecordNew('sym-2', 'Bar', file, scope.id, 'interface');

      const rel1: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: sym1.id,
        targetName: 'Base',
        relationKind: 'extends',
        byteRange: byteRangeGet(10, 14),
      };
      const rel2: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: sym2.id,
        targetName: 'IParent',
        relationKind: 'extends',
        byteRange: byteRangeGet(60, 67),
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [sym1, sym2],
        scopes: [scope],
        relations: [rel1, rel2],
      }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const rels = idx.typeRelationsInFileGet(file);
      expect(rels).toHaveLength(2);
      expect(rels.map(r => r.targetName).sort()).toEqual(['Base', 'IParent']);
    });
  });

  describe('metadata', () => {
    it('capabilities returns the provided capabilities object', () => {
      const store = indexStoreNew();
      const caps: IndexCapabilities = {
        crossFileResolution: false,
        callGraph: 'none',
        controlFlowGraph: false,
        supportedLanguages: [],
      };

      const idx = projectIndexCreate(store, caps);
      expect(idx.capabilities).toBe(caps);
      expect(idx.capabilities.crossFileResolution).toBe(false);
      expect(idx.capabilities.callGraph).toBe('none');
    });

    it('statsGet() returns correct counts', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-1', 'foo', file, scope.id);
      const ref: ReferencesRelation = {
        kind: 'References',
        scopeId: scope.id,
        name: 'foo',
        byteRange: byteRangeGet(60, 63),
        resolvedSymbolId: sym.id,
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [ref] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.statsGet()).toEqual({
        files: 1,
        symbols: 1,
        scopes: 1,
        relations: 1,
      });
    });
  });

  // ============================================================================
  // Control Flow Graph Queries
  // ============================================================================

  describe('control flow graph queries', () => {
    function simpleCfgCreate(scopeId: string, edgeCount: number, nodeCount: number): FlowGraph {
      const nodes = [];
      const edges = [];
      for (let i = 0; i < nodeCount; i++) {
        nodes.push({ id: `${scopeId}:n${i}`, kind: i === 0 ? 'entry' as const : i === nodeCount - 1 ? 'exit' as const : 'statement' as const });
      }
      for (let i = 0; i < edgeCount; i++) {
        edges.push({ from: nodes[Math.min(i, nodeCount - 1)].id, to: nodes[Math.min(i + 1, nodeCount - 1)].id });
      }
      return { scopeId, nodes, edges };
    }

    it('cfgGet returns the CFG for a scope', () => {
      const store = indexStoreNew();
      const file = '/src/cfg.ts';
      const scope = scopeRecordNew('scope-fn', file, 'function');
      const cfg = simpleCfgCreate(scope.id, 2, 3);

      store.filePut(fileIndexDeltaNew({ file, scopes: [scope], cfgs: [cfg] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const result = idx.cfgGet(scope.id);
      expect(result).toBeDefined();
      expect(result!.scopeId).toBe(scope.id);
      expect(result!.nodes).toHaveLength(3);
    });

    it('cyclomaticComplexityGet returns correct value for a function', () => {
      const store = indexStoreNew();
      const file = '/src/cc.ts';
      const fileScope = scopeRecordNew('scope-file', file, 'file');
      // Function scope contains the symbol
      const fnScope = scopeRecordNew('scope-fn', file, 'function', fileScope.id, byteRangeGet(0, 100));
      const sym = symbolRecordNew('sym-fn', 'myFunc', file, fnScope.id, 'function', SymbolFlags.None, byteRangeGet(0, 100));

      // CFG with 4 nodes and 4 edges → V(G) = 4 - 4 + 2 = 2
      const cfg: FlowGraph = {
        scopeId: fnScope.id,
        nodes: [
          { id: 'n0', kind: 'entry' },
          { id: 'n1', kind: 'branch', byteRange: byteRangeGet(10, 20) },
          { id: 'n2', kind: 'merge' },
          { id: 'n3', kind: 'exit' },
        ],
        edges: [
          { from: 'n0', to: 'n1' },
          { from: 'n1', to: 'n2', label: 'true' },
          { from: 'n1', to: 'n2', label: 'false' },
          { from: 'n2', to: 'n3' },
        ],
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [sym],
        scopes: [fileScope, fnScope],
        cfgs: [cfg],
      }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const cc = idx.cyclomaticComplexityGet(sym.id);
      expect(cc).toBe(2); // E(4) - N(4) + 2 = 2
    });

    it('cyclomaticComplexityGet returns undefined for non-function symbol', () => {
      const store = indexStoreNew();
      const file = '/src/cc2.ts';
      const scope = scopeRecordNew('scope-file', file, 'file');
      const sym = symbolRecordNew('sym-var', 'count', file, scope.id, 'variable');

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.cyclomaticComplexityGet(sym.id)).toBeUndefined();
    });
  });
});

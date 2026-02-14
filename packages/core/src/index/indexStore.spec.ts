import { describe, it, expect } from 'vitest';
import { indexStoreNew } from './indexStore';
import {
  SymbolFlags,
  type ReferencesRelation,
  type CallsRelation,
  type ImportBindingRelation,
  type ExportsRelation,
  type TypeRelation,
  type FlowGraph,
} from './indexTypes';
import { byteRangeGet, scopeRecordNew, symbolRecordNew, fileIndexDeltaNew } from './testHelpers';

// ============================================================================
// Tests
// ============================================================================

describe('IndexStore', () => {
  it('indexStoreNew() returns an empty store', () => {
    const store = indexStoreNew();

    expect(store.statsGet()).toEqual({
      files: 0,
      symbols: 0,
      scopes: 0,
      relations: 0,
    });
  });

  it('filePut / symbolsGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/a.ts';
    const scope = scopeRecordNew('scope-a', file);
    const sym1 = symbolRecordNew('sym-1', 'foo', file, scope.id);
    const sym2 = symbolRecordNew('sym-2', 'bar', file, scope.id, 'variable');

    store.filePut(fileIndexDeltaNew({ file, symbols: [sym1, sym2], scopes: [scope] }));

    const symbols = store.symbolsGet({ file });
    expect(symbols).toHaveLength(2);
    expect(symbols.map(s => s.name).sort()).toEqual(['bar', 'foo']);
  });

  it('filePut / scopesInFileGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/b.ts';
    const fileScope = scopeRecordNew('scope-file', file, 'file');
    const fnScope = scopeRecordNew('scope-fn', file, 'function', fileScope.id);

    store.filePut(fileIndexDeltaNew({ file, scopes: [fileScope, fnScope] }));

    const scopes = store.scopesInFileGet(file);
    expect(scopes).toHaveLength(2);
    expect(scopes.map(s => s.kind).sort()).toEqual(['file', 'function']);
  });

  it('filePut / referencesGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/c.ts';
    const scope = scopeRecordNew('scope-c', file);
    const sym = symbolRecordNew('sym-target', 'target', file, scope.id);
    const ref: ReferencesRelation = {
      kind: 'References',
      scopeId: scope.id,
      name: 'target',
      byteRange: byteRangeGet(10, 16),
      resolvedSymbolId: sym.id,
    };

    store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [ref] }));

    const refs = store.referencesGet(sym.id);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe('target');
  });

  it('filePut / callsGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/d.ts';
    const scope = scopeRecordNew('scope-d', file, 'function');
    const call: CallsRelation = {
      kind: 'Calls',
      scopeId: scope.id,
      calleeName: 'doWork',
      byteRange: byteRangeGet(20, 26),
    };

    store.filePut(fileIndexDeltaNew({ file, scopes: [scope], relations: [call] }));

    const calls = store.callsGet();
    expect(calls).toHaveLength(1);
    expect(calls[0].calleeName).toBe('doWork');
  });

  it('filePut / importBindingsInFileGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/e.ts';
    const scope = scopeRecordNew('scope-e', file);
    const importedSym = symbolRecordNew('sym-imported', 'utils', file, scope.id, 'variable');
    const binding: ImportBindingRelation = {
      kind: 'ImportBinding',
      localSymbolId: importedSym.id,
      importedName: 'utils',
      moduleSpec: './utils',
      isDefault: false,
      isNamespace: false,
      byteRange: byteRangeGet(0, 30),
    };

    store.filePut(fileIndexDeltaNew({
      file,
      symbols: [importedSym],
      scopes: [scope],
      relations: [binding],
    }));

    const bindings = store.importBindingsInFileGet(file);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].importedName).toBe('utils');
  });

  it('filePut / exportsInFileGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/f.ts';
    const scope = scopeRecordNew('scope-f', file);
    const sym = symbolRecordNew('sym-exported', 'myFunc', file, scope.id);
    const exp: ExportsRelation = {
      kind: 'Exports',
      symbolId: sym.id,
      exportedName: 'myFunc',
      isDefault: false,
      byteRange: byteRangeGet(0, 40),
    };

    store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [exp] }));

    const exports = store.exportsInFileGet(file);
    expect(exports).toHaveLength(1);
    expect(exports[0].exportedName).toBe('myFunc');
  });

  it('fileRemove clears all relations for file', () => {
    const store = indexStoreNew();
    const file = '/src/g.ts';
    const scope = scopeRecordNew('scope-g', file);
    const sym = symbolRecordNew('sym-g', 'gone', file, scope.id);
    const ref: ReferencesRelation = {
      kind: 'References',
      scopeId: scope.id,
      name: 'gone',
      byteRange: byteRangeGet(0, 4),
      resolvedSymbolId: sym.id,
    };
    const exp: ExportsRelation = {
      kind: 'Exports',
      symbolId: sym.id,
      exportedName: 'gone',
      isDefault: false,
      byteRange: byteRangeGet(0, 20),
    };

    store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [ref, exp] }));
    store.fileRemove(file);

    expect(store.symbolsGet({ file })).toHaveLength(0);
    expect(store.scopesInFileGet(file)).toHaveLength(0);
    expect(store.referencesGet(sym.id)).toHaveLength(0);
    expect(store.exportsInFileGet(file)).toHaveLength(0);
    expect(store.filesGet()).not.toContain(file);
    expect(store.statsGet().files).toBe(0);
  });

  it('exportMapBuild returns correct map for multiple files', () => {
    const store = indexStoreNew();

    const fileA = '/src/a.ts';
    const scopeA = scopeRecordNew('scope-ea', fileA);
    const symA = symbolRecordNew('sym-ea', 'alpha', fileA, scopeA.id);
    const expA: ExportsRelation = {
      kind: 'Exports',
      symbolId: symA.id,
      exportedName: 'alpha',
      isDefault: false,
      byteRange: byteRangeGet(0, 10),
    };

    const fileB = '/src/b.ts';
    const scopeB = scopeRecordNew('scope-eb', fileB);
    const symB = symbolRecordNew('sym-eb', 'beta', fileB, scopeB.id);
    const expB: ExportsRelation = {
      kind: 'Exports',
      symbolId: symB.id,
      exportedName: 'beta',
      isDefault: false,
      byteRange: byteRangeGet(0, 10),
    };

    store.filePut(fileIndexDeltaNew({ file: fileA, symbols: [symA], scopes: [scopeA], relations: [expA] }));
    store.filePut(fileIndexDeltaNew({ file: fileB, symbols: [symB], scopes: [scopeB], relations: [expB] }));

    const exportMap = store.exportMapBuild();

    expect(exportMap.size).toBe(2);
    expect(exportMap.get(fileA)?.get('alpha')).toBe(symA.id);
    expect(exportMap.get(fileB)?.get('beta')).toBe(symB.id);
  });

  it('relationUpdate modifies an existing ImportBinding relation', () => {
    const store = indexStoreNew();
    const file = '/src/h.ts';
    const scope = scopeRecordNew('scope-h', file);
    const localSym = symbolRecordNew('sym-local', 'helper', file, scope.id, 'variable');
    const original: ImportBindingRelation = {
      kind: 'ImportBinding',
      localSymbolId: localSym.id,
      importedName: 'helper',
      moduleSpec: './helper',
      isDefault: false,
      isNamespace: false,
      byteRange: byteRangeGet(0, 30),
    };

    store.filePut(fileIndexDeltaNew({ file, symbols: [localSym], scopes: [scope], relations: [original] }));

    // Retrieve the stored relation (same object identity)
    const storedBindings = store.importBindingsInFileGet(file);
    expect(storedBindings).toHaveLength(1);
    const storedBinding = storedBindings[0];

    const updated: ImportBindingRelation = {
      ...storedBinding,
      resolvedModulePath: '/src/helper.ts',
      resolvedExportId: 'sym-remote',
    };

    store.relationUpdate(storedBinding, updated);

    const afterUpdate = store.importBindingsInFileGet(file);
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0].resolvedExportId).toBe('sym-remote');
    expect(afterUpdate[0].resolvedModulePath).toBe('/src/helper.ts');
  });

  it('symbolGet by ID returns the correct symbol', () => {
    const store = indexStoreNew();
    const file = '/src/i.ts';
    const scope = scopeRecordNew('scope-i', file);
    const sym = symbolRecordNew('sym-i', 'myVar', file, scope.id, 'const', SymbolFlags.Exported);

    store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope] }));

    const found = store.symbolGet('sym-i');
    expect(found).toBeDefined();
    expect(found!.name).toBe('myVar');
    expect(found!.kind).toBe('const');
    expect(found!.flags).toBe(SymbolFlags.Exported);
  });

  it('symbolsGet with SymbolFilter filters by name, kind, file, and scopeId', () => {
    const store = indexStoreNew();
    const file = '/src/j.ts';
    const scope1 = scopeRecordNew('scope-j1', file, 'file');
    const scope2 = scopeRecordNew('scope-j2', file, 'function', scope1.id);
    const symFn = symbolRecordNew('sym-fn', 'doStuff', file, scope1.id, 'function');
    const symVar = symbolRecordNew('sym-var', 'count', file, scope2.id, 'variable');
    const symConst = symbolRecordNew('sym-const', 'MAX', file, scope1.id, 'const');

    store.filePut(fileIndexDeltaNew({
      file,
      symbols: [symFn, symVar, symConst],
      scopes: [scope1, scope2],
    }));

    // Filter by name
    expect(store.symbolsGet({ name: 'doStuff' })).toHaveLength(1);
    expect(store.symbolsGet({ name: 'doStuff' })[0].id).toBe('sym-fn');

    // Filter by kind
    expect(store.symbolsGet({ kind: 'variable' })).toHaveLength(1);
    expect(store.symbolsGet({ kind: 'variable' })[0].name).toBe('count');

    // Filter by file
    expect(store.symbolsGet({ file })).toHaveLength(3);

    // Filter by scopeId
    expect(store.symbolsGet({ scopeId: scope2.id })).toHaveLength(1);
    expect(store.symbolsGet({ scopeId: scope2.id })[0].name).toBe('count');
  });

  it('filesGet lists all indexed files', () => {
    const store = indexStoreNew();
    const fileA = '/src/x.ts';
    const fileB = '/src/y.ts';

    store.filePut(fileIndexDeltaNew({ file: fileA, scopes: [scopeRecordNew('s-x', fileA)] }));
    store.filePut(fileIndexDeltaNew({ file: fileB, scopes: [scopeRecordNew('s-y', fileB)] }));

    const files = store.filesGet();
    expect(files).toHaveLength(2);
    expect(files.sort()).toEqual([fileA, fileB].sort());
  });

  it('clear() empties everything', () => {
    const store = indexStoreNew();
    const file = '/src/z.ts';
    const scope = scopeRecordNew('scope-z', file);
    const sym = symbolRecordNew('sym-z', 'z', file, scope.id);

    store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope] }));
    expect(store.statsGet().files).toBe(1);

    store.clear();

    expect(store.statsGet()).toEqual({
      files: 0,
      symbols: 0,
      scopes: 0,
      relations: 0,
    });
    expect(store.filesGet()).toHaveLength(0);
    expect(store.symbolsGet()).toHaveLength(0);
  });

  // ============================================================================
  // Type Relation Tests
  // ============================================================================

  describe('TypeRelation', () => {
    it('filePut / typeRelationsForSymbolGet round-trip', () => {
      const store = indexStoreNew();
      const file = '/src/tr.ts';
      const scope = scopeRecordNew('scope-tr', file);
      const childSym = symbolRecordNew('sym-child', 'Dog', file, scope.id, 'class');
      const parentSym = symbolRecordNew('sym-parent', 'Animal', file, scope.id, 'class');
      const typeRel: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: childSym.id,
        targetName: 'Animal',
        relationKind: 'extends',
        byteRange: byteRangeGet(20, 26),
        resolvedTargetId: parentSym.id,
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [childSym, parentSym],
        scopes: [scope],
        relations: [typeRel],
      }));

      const rels = store.typeRelationsForSymbolGet(childSym.id);
      expect(rels).toHaveLength(1);
      expect(rels[0].targetName).toBe('Animal');
      expect(rels[0].relationKind).toBe('extends');
      expect(rels[0].resolvedTargetId).toBe(parentSym.id);
    });

    it('typeRelationsByTargetNameGet returns relations targeting a name', () => {
      const store = indexStoreNew();
      const file = '/src/tr2.ts';
      const scope = scopeRecordNew('scope-tr2', file);
      const ifaceSym = symbolRecordNew('sym-iface', 'IMovable', file, scope.id, 'interface');
      const classSym = symbolRecordNew('sym-impl', 'Car', file, scope.id, 'class');
      const typeRel: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: classSym.id,
        targetName: 'IMovable',
        relationKind: 'implements',
        byteRange: byteRangeGet(30, 38),
        resolvedTargetId: ifaceSym.id,
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [ifaceSym, classSym],
        scopes: [scope],
        relations: [typeRel],
      }));

      const rels = store.typeRelationsByTargetNameGet('IMovable');
      expect(rels).toHaveLength(1);
      expect(rels[0].symbolId).toBe(classSym.id);
      expect(rels[0].relationKind).toBe('implements');
    });

    it('typeRelationsInFileGet returns all type relations in a file', () => {
      const store = indexStoreNew();
      const file = '/src/tr3.ts';
      const scope = scopeRecordNew('scope-tr3', file);
      const classSym = symbolRecordNew('sym-multi', 'Widget', file, scope.id, 'class');
      const rel1: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: classSym.id,
        targetName: 'Base',
        relationKind: 'extends',
        byteRange: byteRangeGet(10, 14),
      };
      const rel2: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: classSym.id,
        targetName: 'IRenderable',
        relationKind: 'implements',
        byteRange: byteRangeGet(20, 31),
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [classSym],
        scopes: [scope],
        relations: [rel1, rel2],
      }));

      const rels = store.typeRelationsInFileGet(file);
      expect(rels).toHaveLength(2);
      expect(rels.map(r => r.targetName).sort()).toEqual(['Base', 'IRenderable']);
    });

    it('fileRemove clears type relations for file', () => {
      const store = indexStoreNew();
      const file = '/src/tr4.ts';
      const scope = scopeRecordNew('scope-tr4', file);
      const sym = symbolRecordNew('sym-tr4', 'Foo', file, scope.id, 'class');
      const typeRel: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: sym.id,
        targetName: 'Bar',
        relationKind: 'extends',
        byteRange: byteRangeGet(5, 8),
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [sym],
        scopes: [scope],
        relations: [typeRel],
      }));

      expect(store.typeRelationsForSymbolGet(sym.id)).toHaveLength(1);
      expect(store.typeRelationsByTargetNameGet('Bar')).toHaveLength(1);
      expect(store.typeRelationsInFileGet(file)).toHaveLength(1);

      store.fileRemove(file);

      expect(store.typeRelationsForSymbolGet(sym.id)).toHaveLength(0);
      expect(store.typeRelationsByTargetNameGet('Bar')).toHaveLength(0);
      expect(store.typeRelationsInFileGet(file)).toHaveLength(0);
    });

    it('clear() empties type relations', () => {
      const store = indexStoreNew();
      const file = '/src/tr5.ts';
      const scope = scopeRecordNew('scope-tr5', file);
      const sym = symbolRecordNew('sym-tr5', 'Baz', file, scope.id, 'class');
      const typeRel: TypeRelation = {
        kind: 'TypeRelation',
        symbolId: sym.id,
        targetName: 'Qux',
        relationKind: 'extends',
        byteRange: byteRangeGet(0, 3),
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [sym],
        scopes: [scope],
        relations: [typeRel],
      }));

      store.clear();

      expect(store.typeRelationsForSymbolGet(sym.id)).toHaveLength(0);
      expect(store.typeRelationsByTargetNameGet('Qux')).toHaveLength(0);
      expect(store.typeRelationsInFileGet(file)).toHaveLength(0);
    });
  });

  // ============================================================================
  // Control Flow Graph Storage
  // ============================================================================

  describe('control flow graph storage', () => {
    function cfgCreate(scopeId: string): FlowGraph {
      return {
        scopeId,
        nodes: [
          { id: `${scopeId}:entry:0`, kind: 'entry', label: 'entry' },
          { id: `${scopeId}:exit:1`, kind: 'exit', label: 'exit' },
          { id: `${scopeId}:statement:2`, kind: 'statement', byteRange: byteRangeGet(10, 20) },
        ],
        edges: [
          { from: `${scopeId}:entry:0`, to: `${scopeId}:statement:2`, label: 'unconditional' },
          { from: `${scopeId}:statement:2`, to: `${scopeId}:exit:1`, label: 'unconditional' },
        ],
      };
    }

    it('filePut / cfgGet round-trip', () => {
      const store = indexStoreNew();
      const file = '/src/cfg1.ts';
      const scope = scopeRecordNew('scope-fn', file, 'function');
      const cfg = cfgCreate(scope.id);

      store.filePut(fileIndexDeltaNew({ file, scopes: [scope], cfgs: [cfg] }));

      const result = store.cfgGet(scope.id);
      expect(result).toBeDefined();
      expect(result!.scopeId).toBe(scope.id);
      expect(result!.nodes).toHaveLength(3);
      expect(result!.edges).toHaveLength(2);
    });

    it('cfgsInFileGet returns CFGs for file', () => {
      const store = indexStoreNew();
      const file = '/src/cfg2.ts';
      const scope1 = scopeRecordNew('scope-fn1', file, 'function');
      const scope2 = scopeRecordNew('scope-fn2', file, 'function');
      const cfg1 = cfgCreate(scope1.id);
      const cfg2 = cfgCreate(scope2.id);

      store.filePut(fileIndexDeltaNew({ file, scopes: [scope1, scope2], cfgs: [cfg1, cfg2] }));

      const result = store.cfgsInFileGet(file);
      expect(result).toHaveLength(2);
      expect(result.map(c => c.scopeId).sort()).toEqual([scope1.id, scope2.id].sort());
    });

    it('fileRemove clears CFGs', () => {
      const store = indexStoreNew();
      const file = '/src/cfg3.ts';
      const scope = scopeRecordNew('scope-fn3', file, 'function');
      const cfg = cfgCreate(scope.id);

      store.filePut(fileIndexDeltaNew({ file, scopes: [scope], cfgs: [cfg] }));
      expect(store.cfgGet(scope.id)).toBeDefined();

      store.fileRemove(file);

      expect(store.cfgGet(scope.id)).toBeUndefined();
      expect(store.cfgsInFileGet(file)).toHaveLength(0);
    });

    it('clear() clears CFGs', () => {
      const store = indexStoreNew();
      const file = '/src/cfg4.ts';
      const scope = scopeRecordNew('scope-fn4', file, 'function');
      const cfg = cfgCreate(scope.id);

      store.filePut(fileIndexDeltaNew({ file, scopes: [scope], cfgs: [cfg] }));
      store.clear();

      expect(store.cfgGet(scope.id)).toBeUndefined();
      expect(store.cfgsInFileGet(file)).toHaveLength(0);
    });

    it('cfgGet returns undefined for unknown scope', () => {
      const store = indexStoreNew();
      expect(store.cfgGet('nonexistent-scope')).toBeUndefined();
    });
  });
});

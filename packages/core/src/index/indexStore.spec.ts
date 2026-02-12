import { describe, it, expect } from 'vitest';
import {
  indexStoreNew,
  type FileIndexDelta,
} from './indexStore';
import {
  SymbolFlags,
  type SymbolRecord,
  type ScopeRecord,
  type ReferencesRelation,
  type CallsRelation,
  type ImportBindingRelation,
  type ExportsRelation,
} from './indexTypes';

// ============================================================================
// Helpers
// ============================================================================

const range = (start: number, end: number) => ({ start, end });

function makeScope(
  id: string,
  file: string,
  kind: ScopeRecord['kind'] = 'file',
  parent?: string,
): ScopeRecord {
  return { id, kind, file, range: range(0, 100), parent };
}

function makeSymbol(
  id: string,
  name: string,
  file: string,
  scopeId: string,
  kind: SymbolRecord['kind'] = 'function',
  flags: number = SymbolFlags.None,
): SymbolRecord {
  return { id, kind, name, file, range: range(0, 50), scopeId, qualName: name, flags };
}

function makeDelta(overrides: Partial<FileIndexDelta> & { file: string }): FileIndexDelta {
  return {
    revision: 'rev1',
    symbols: [],
    scopes: [],
    relations: [],
    ...overrides,
  };
}

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
    const scope = makeScope('scope-a', file);
    const sym1 = makeSymbol('sym-1', 'foo', file, scope.id);
    const sym2 = makeSymbol('sym-2', 'bar', file, scope.id, 'variable');

    store.filePut(makeDelta({ file, symbols: [sym1, sym2], scopes: [scope] }));

    const symbols = store.symbolsGet({ file });
    expect(symbols).toHaveLength(2);
    expect(symbols.map(s => s.name).sort()).toEqual(['bar', 'foo']);
  });

  it('filePut / scopesInFileGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/b.ts';
    const fileScope = makeScope('scope-file', file, 'file');
    const fnScope = makeScope('scope-fn', file, 'function', fileScope.id);

    store.filePut(makeDelta({ file, scopes: [fileScope, fnScope] }));

    const scopes = store.scopesInFileGet(file);
    expect(scopes).toHaveLength(2);
    expect(scopes.map(s => s.kind).sort()).toEqual(['file', 'function']);
  });

  it('filePut / referencesGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/c.ts';
    const scope = makeScope('scope-c', file);
    const sym = makeSymbol('sym-target', 'target', file, scope.id);
    const ref: ReferencesRelation = {
      kind: 'References',
      scopeId: scope.id,
      name: 'target',
      range: range(10, 16),
      resolvedSymbolId: sym.id,
    };

    store.filePut(makeDelta({ file, symbols: [sym], scopes: [scope], relations: [ref] }));

    const refs = store.referencesGet(sym.id);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe('target');
  });

  it('filePut / callsGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/d.ts';
    const scope = makeScope('scope-d', file, 'function');
    const call: CallsRelation = {
      kind: 'Calls',
      scopeId: scope.id,
      calleeName: 'doWork',
      range: range(20, 26),
    };

    store.filePut(makeDelta({ file, scopes: [scope], relations: [call] }));

    const calls = store.callsGet();
    expect(calls).toHaveLength(1);
    expect(calls[0].calleeName).toBe('doWork');
  });

  it('filePut / importBindingsInFileGet round-trip', () => {
    const store = indexStoreNew();
    const file = '/src/e.ts';
    const scope = makeScope('scope-e', file);
    const importedSym = makeSymbol('sym-imported', 'utils', file, scope.id, 'variable');
    const binding: ImportBindingRelation = {
      kind: 'ImportBinding',
      localSymbolId: importedSym.id,
      importedName: 'utils',
      moduleSpec: './utils',
      isDefault: false,
      isNamespace: false,
      range: range(0, 30),
    };

    store.filePut(makeDelta({
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
    const scope = makeScope('scope-f', file);
    const sym = makeSymbol('sym-exported', 'myFunc', file, scope.id);
    const exp: ExportsRelation = {
      kind: 'Exports',
      symbolId: sym.id,
      exportedName: 'myFunc',
      isDefault: false,
      range: range(0, 40),
    };

    store.filePut(makeDelta({ file, symbols: [sym], scopes: [scope], relations: [exp] }));

    const exports = store.exportsInFileGet(file);
    expect(exports).toHaveLength(1);
    expect(exports[0].exportedName).toBe('myFunc');
  });

  it('fileRemove clears all relations for file', () => {
    const store = indexStoreNew();
    const file = '/src/g.ts';
    const scope = makeScope('scope-g', file);
    const sym = makeSymbol('sym-g', 'gone', file, scope.id);
    const ref: ReferencesRelation = {
      kind: 'References',
      scopeId: scope.id,
      name: 'gone',
      range: range(0, 4),
      resolvedSymbolId: sym.id,
    };
    const exp: ExportsRelation = {
      kind: 'Exports',
      symbolId: sym.id,
      exportedName: 'gone',
      isDefault: false,
      range: range(0, 20),
    };

    store.filePut(makeDelta({ file, symbols: [sym], scopes: [scope], relations: [ref, exp] }));
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
    const scopeA = makeScope('scope-ea', fileA);
    const symA = makeSymbol('sym-ea', 'alpha', fileA, scopeA.id);
    const expA: ExportsRelation = {
      kind: 'Exports',
      symbolId: symA.id,
      exportedName: 'alpha',
      isDefault: false,
      range: range(0, 10),
    };

    const fileB = '/src/b.ts';
    const scopeB = makeScope('scope-eb', fileB);
    const symB = makeSymbol('sym-eb', 'beta', fileB, scopeB.id);
    const expB: ExportsRelation = {
      kind: 'Exports',
      symbolId: symB.id,
      exportedName: 'beta',
      isDefault: false,
      range: range(0, 10),
    };

    store.filePut(makeDelta({ file: fileA, symbols: [symA], scopes: [scopeA], relations: [expA] }));
    store.filePut(makeDelta({ file: fileB, symbols: [symB], scopes: [scopeB], relations: [expB] }));

    const exportMap = store.exportMapBuild();

    expect(exportMap.size).toBe(2);
    expect(exportMap.get(fileA)?.get('alpha')).toBe(symA.id);
    expect(exportMap.get(fileB)?.get('beta')).toBe(symB.id);
  });

  it('relationUpdate modifies an existing ImportBinding relation', () => {
    const store = indexStoreNew();
    const file = '/src/h.ts';
    const scope = makeScope('scope-h', file);
    const localSym = makeSymbol('sym-local', 'helper', file, scope.id, 'variable');
    const original: ImportBindingRelation = {
      kind: 'ImportBinding',
      localSymbolId: localSym.id,
      importedName: 'helper',
      moduleSpec: './helper',
      isDefault: false,
      isNamespace: false,
      range: range(0, 30),
    };

    store.filePut(makeDelta({ file, symbols: [localSym], scopes: [scope], relations: [original] }));

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
    const scope = makeScope('scope-i', file);
    const sym = makeSymbol('sym-i', 'myVar', file, scope.id, 'const', SymbolFlags.Exported);

    store.filePut(makeDelta({ file, symbols: [sym], scopes: [scope] }));

    const found = store.symbolGet('sym-i');
    expect(found).toBeDefined();
    expect(found!.name).toBe('myVar');
    expect(found!.kind).toBe('const');
    expect(found!.flags).toBe(SymbolFlags.Exported);
  });

  it('symbolsGet with SymbolFilter filters by name, kind, file, and scopeId', () => {
    const store = indexStoreNew();
    const file = '/src/j.ts';
    const scope1 = makeScope('scope-j1', file, 'file');
    const scope2 = makeScope('scope-j2', file, 'function', scope1.id);
    const symFn = makeSymbol('sym-fn', 'doStuff', file, scope1.id, 'function');
    const symVar = makeSymbol('sym-var', 'count', file, scope2.id, 'variable');
    const symConst = makeSymbol('sym-const', 'MAX', file, scope1.id, 'const');

    store.filePut(makeDelta({
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

    store.filePut(makeDelta({ file: fileA, scopes: [makeScope('s-x', fileA)] }));
    store.filePut(makeDelta({ file: fileB, scopes: [makeScope('s-y', fileB)] }));

    const files = store.filesGet();
    expect(files).toHaveLength(2);
    expect(files.sort()).toEqual([fileA, fileB].sort());
  });

  it('clear() empties everything', () => {
    const store = indexStoreNew();
    const file = '/src/z.ts';
    const scope = makeScope('scope-z', file);
    const sym = makeSymbol('sym-z', 'z', file, scope.id);

    store.filePut(makeDelta({ file, symbols: [sym], scopes: [scope] }));
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
});

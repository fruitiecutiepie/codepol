import { describe, it, expect } from 'vitest';
import { indexStoreNew, type FileIndexDelta } from './indexStore';
import { projectIndexCreate } from './indexQuery';
import {
  SymbolFlags,
  type SymbolRecord,
  type ScopeRecord,
  type IndexCapabilities,
  type ReferencesRelation,
  type CallsRelation,
  type ImportBindingRelation,
  type ExportsRelation,
  type ImportsRelation,
} from './indexTypes';

// ============================================================================
// Helpers (same pattern as indexStore.spec.ts)
// ============================================================================

const range = (start: number, end: number) => ({ start, end });

function scopeRecordNew(
  id: string,
  file: string,
  kind: ScopeRecord['kind'] = 'file',
  parent?: string,
  scopeRange?: { start: number; end: number },
): ScopeRecord {
  return { id, kind, file, range: scopeRange ?? range(0, 100), parent };
}

function symbolRecordNew(
  id: string,
  name: string,
  file: string,
  scopeId: string,
  kind: SymbolRecord['kind'] = 'function',
  flags: number = SymbolFlags.None,
  symbolRange?: { start: number; end: number },
): SymbolRecord {
  return { id, kind, name, file, range: symbolRange ?? range(0, 50), scopeId, qualName: name, flags };
}

function fileIndexDeltaNew(overrides: Partial<FileIndexDelta> & { file: string }): FileIndexDelta {
  return {
    revision: 'rev1',
    symbols: [],
    scopes: [],
    relations: [],
    ...overrides,
  };
}

const defaultCapabilities: IndexCapabilities = {
  crossFileResolution: true,
  callGraph: 'heuristic',
  supportedLanguages: ['typescript'],
};

// ============================================================================
// Tests
// ============================================================================

describe('ProjectIndex', () => {
  describe('symbol queries', () => {
    it('getSymbols() returns all symbols across files', () => {
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
      const all = idx.getSymbols();
      expect(all).toHaveLength(3);
      expect(all.map(s => s.name).sort()).toEqual(['bar', 'baz', 'foo']);
    });

    it('getSymbol(id) returns the symbol or undefined', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-1', 'foo', file, scope.id);

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.getSymbol('sym-1')).toBeDefined();
      expect(idx.getSymbol('sym-1')!.name).toBe('foo');
      expect(idx.getSymbol('nonexistent')).toBeUndefined();
    });

    it('getSymbolsInFile(file) returns only symbols from that file', () => {
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
      const inA = idx.getSymbolsInFile(fileA);
      expect(inA).toHaveLength(1);
      expect(inA[0].name).toBe('foo');
    });

    it('getSymbolsByName(name) returns matching symbols across files', () => {
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
      const helpers = idx.getSymbolsByName('helper');
      expect(helpers).toHaveLength(2);
      expect(helpers.map(s => s.file).sort()).toEqual([fileA, fileB]);
    });
  });

  describe('export queries', () => {
    it('getExportedSymbols() filters by Exported flag', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const exported = symbolRecordNew('sym-exp', 'pubFn', file, scope.id, 'function', SymbolFlags.Exported);
      const internal = symbolRecordNew('sym-int', 'privFn', file, scope.id, 'function', SymbolFlags.None);
      const alsoExported = symbolRecordNew('sym-exp2', 'PubClass', file, scope.id, 'class', SymbolFlags.Exported);

      store.filePut(fileIndexDeltaNew({ file, symbols: [exported, internal, alsoExported], scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const result = idx.getExportedSymbols({ file });
      expect(result).toHaveLength(2);
      expect(result.map(s => s.name).sort()).toEqual(['PubClass', 'pubFn']);
    });

    it('getExporters(symbolName) returns exported symbols with that name', () => {
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
      const exporters = idx.getExporters('Config');
      expect(exporters).toHaveLength(2);
      expect(exporters.every(s => (s.flags & SymbolFlags.Exported) !== 0)).toBe(true);
    });

    it('getExportLocations(symbolId) returns file and exported name', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-a', 'doWork', file, scope.id);
      const exp: ExportsRelation = {
        kind: 'Exports',
        symbolId: sym.id,
        exportedName: 'doWork',
        isDefault: false,
        range: range(0, 30),
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [exp] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const locs = idx.getExportLocations('sym-a');
      expect(locs).toHaveLength(1);
      expect(locs[0]).toEqual({ file: '/src/a.ts', exportedName: 'doWork' });
    });
  });

  describe('reference queries', () => {
    it('getReferencesInFile(file) returns references in that file', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-target', 'target', file, scope.id);
      const ref: ReferencesRelation = {
        kind: 'References',
        scopeId: scope.id,
        name: 'target',
        range: range(60, 66),
        resolvedSymbolId: sym.id,
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [ref] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const refs = idx.getReferencesInFile(file);
      expect(refs).toHaveLength(1);
      expect(refs[0].name).toBe('target');
      expect(refs[0].resolvedSymbolId).toBe('sym-target');
    });
  });

  describe('call graph queries', () => {
    // Layout for getCallers:
    //   file scope (scope-file, kind=file, range 0..500)
    //     callerFn symbol (sym-caller, kind=function, scopeId=scope-file, range 0..200)
    //       fnBody scope (scope-fn, kind=function, parent=scope-file, range 10..190)
    //         Calls relation in scope-fn, resolvedSymbolId=sym-callee
    //   callee symbol (sym-callee) in same or different file
    it('getCallers(symbolId) resolves caller function symbols', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';

      const fileScope = scopeRecordNew('scope-file', file, 'file', undefined, range(0, 500));
      const fnBodyScope = scopeRecordNew('scope-fn', file, 'function', fileScope.id, range(10, 190));
      const callerSym = symbolRecordNew('sym-caller', 'doStuff', file, fileScope.id, 'function', SymbolFlags.None, range(0, 200));
      const calleeSym = symbolRecordNew('sym-callee', 'helper', file, fileScope.id, 'function', SymbolFlags.None, range(300, 400));

      const call: CallsRelation = {
        kind: 'Calls',
        scopeId: fnBodyScope.id,
        calleeName: 'helper',
        range: range(50, 56),
        resolvedSymbolId: calleeSym.id,
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [callerSym, calleeSym],
        scopes: [fileScope, fnBodyScope],
        relations: [call],
      }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const callers = idx.getCallers('sym-callee');
      expect(callers).toHaveLength(1);
      expect(callers[0]).toBe('sym-caller');
    });

    // Layout for getCallees:
    //   file scope (range 0..500)
    //     callerFn symbol (kind=function, range 0..200)
    //       fnBody scope (kind=function, range 10..190) — within caller symbol range
    //         Calls relation with resolvedSymbolId=sym-callee
    it('getCallees(symbolId) returns callee symbol IDs', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';

      const fileScope = scopeRecordNew('scope-file', file, 'file', undefined, range(0, 500));
      const fnBodyScope = scopeRecordNew('scope-fn', file, 'function', fileScope.id, range(10, 190));
      const callerSym = symbolRecordNew('sym-caller', 'doStuff', file, fileScope.id, 'function', SymbolFlags.None, range(0, 200));
      const calleeSym = symbolRecordNew('sym-callee', 'helper', file, fileScope.id, 'function', SymbolFlags.None, range(300, 400));

      const call: CallsRelation = {
        kind: 'Calls',
        scopeId: fnBodyScope.id,
        calleeName: 'helper',
        range: range(50, 56),
        resolvedSymbolId: calleeSym.id,
      };

      store.filePut(fileIndexDeltaNew({
        file,
        symbols: [callerSym, calleeSym],
        scopes: [fileScope, fnBodyScope],
        relations: [call],
      }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const callees = idx.getCallees('sym-caller');
      expect(callees).toHaveLength(1);
      expect(callees[0]).toBe('sym-callee');
    });

    it('getCallees returns empty for non-function symbols', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-var', 'count', file, scope.id, 'variable');

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.getCallees('sym-var')).toEqual([]);
    });
  });

  describe('scope queries', () => {
    it('getScopesInFile(file) returns all scopes for the file', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const fileScope = scopeRecordNew('scope-file', file, 'file');
      const fnScope = scopeRecordNew('scope-fn', file, 'function', fileScope.id);
      const blockScope = scopeRecordNew('scope-block', file, 'block', fnScope.id);

      store.filePut(fileIndexDeltaNew({ file, scopes: [fileScope, fnScope, blockScope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      const scopes = idx.getScopesInFile(file);
      expect(scopes).toHaveLength(3);
      expect(scopes.map(s => s.kind).sort()).toEqual(['block', 'file', 'function']);
    });
  });

  describe('import/export queries', () => {
    it('resolveImport resolves named import by specifier and name', () => {
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
        range: range(0, 30),
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [localSym], scopes: [scope], relations: [binding] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.resolveImport(file, './utils', 'utils')).toBe('sym-remote-utils');
    });

    it('resolveImport resolves default import', () => {
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
        range: range(0, 30),
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [localSym], scopes: [scope], relations: [binding] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.resolveImport(file, './MyComp', 'default')).toBe('sym-remote-comp');
    });

    it('resolveImport returns undefined for unresolved specifier', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);

      store.filePut(fileIndexDeltaNew({ file, scopes: [scope] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.resolveImport(file, './nonexistent', 'foo')).toBeUndefined();
    });
  });

  describe('metadata', () => {
    it('capabilities returns the provided capabilities object', () => {
      const store = indexStoreNew();
      const caps: IndexCapabilities = {
        crossFileResolution: false,
        callGraph: 'none',
        supportedLanguages: [],
      };

      const idx = projectIndexCreate(store, caps);
      expect(idx.capabilities).toBe(caps);
      expect(idx.capabilities.crossFileResolution).toBe(false);
      expect(idx.capabilities.callGraph).toBe('none');
    });

    it('getStats() returns correct counts', () => {
      const store = indexStoreNew();
      const file = '/src/a.ts';
      const scope = scopeRecordNew('scope-a', file);
      const sym = symbolRecordNew('sym-1', 'foo', file, scope.id);
      const ref: ReferencesRelation = {
        kind: 'References',
        scopeId: scope.id,
        name: 'foo',
        range: range(60, 63),
        resolvedSymbolId: sym.id,
      };

      store.filePut(fileIndexDeltaNew({ file, symbols: [sym], scopes: [scope], relations: [ref] }));

      const idx = projectIndexCreate(store, defaultCapabilities);
      expect(idx.getStats()).toEqual({
        files: 1,
        symbols: 1,
        scopes: 1,
        relations: 1,
      });
    });
  });
});

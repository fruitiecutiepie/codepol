import { describe, expect, it } from 'vitest';
import { projectIndexStoreRestore, projectIndexStoreSnapshotCreate } from './indexSnapshot';
import { projectIndexCreate } from './indexQuery';
import { indexStoreNew } from './indexStore';
import { SymbolFlags, type IndexCapabilities } from './indexTypes';
import {
  byteRangeGet,
  fileIndexDeltaNew,
  scopeRecordNew,
  symbolRecordNew,
} from './testHelpers';

const defaultCapabilities: IndexCapabilities = {
  crossFileResolution: true,
  callGraph: 'heuristic',
  controlFlowGraph: false,
  supportedLanguages: ['typescript'],
};

describe('project index store snapshot', () => {
  it('round-trips cross-file and call-graph queries through store restore', () => {
    const store = indexStoreNew();
    const exporterFile = '/src/exporter.ts';
    const importerFile = '/src/importer.ts';

    const exporterScope = scopeRecordNew('scope-exporter', exporterFile);
    const importerFileScope = scopeRecordNew('scope-importer-file', importerFile);
    const importerFnScope = scopeRecordNew(
      'scope-importer-fn',
      importerFile,
      'function',
      importerFileScope.id,
      byteRangeGet(10, 90),
    );

    const exportedFn = symbolRecordNew(
      'sym-exported-fn',
      'sharedValue',
      exporterFile,
      exporterScope.id,
      'function',
      SymbolFlags.Exported,
      byteRangeGet(0, 100),
    );
    const importedBinding = symbolRecordNew(
      'sym-imported-binding',
      'sharedValue',
      importerFile,
      importerFileScope.id,
      'const',
      SymbolFlags.None,
      byteRangeGet(0, 20),
    );
    const callerFn = symbolRecordNew(
      'sym-caller-fn',
      'useSharedValue',
      importerFile,
      importerFnScope.id,
      'function',
      SymbolFlags.None,
      byteRangeGet(0, 100),
    );

    store.filePut(
      fileIndexDeltaNew({
        file: exporterFile,
        symbols: [exportedFn],
        scopes: [exporterScope],
        relations: [
          {
            kind: 'Exports',
            exportedName: 'sharedValue',
            symbolId: exportedFn.id,
            isType: false,
          },
        ],
      }),
    );
    store.filePut(
      fileIndexDeltaNew({
        file: importerFile,
        symbols: [importedBinding, callerFn],
        scopes: [importerFileScope, importerFnScope],
        relations: [
          {
            kind: 'Imports',
            scopeId: importerFileScope.id,
            spec: './exporter',
            byteRange: byteRangeGet(0, 10),
            resolvedModulePath: exporterFile,
          },
          {
            kind: 'ImportBinding',
            localSymbolId: importedBinding.id,
            importedName: 'sharedValue',
            moduleSpec: './exporter',
            resolvedModulePath: exporterFile,
            resolvedExportId: exportedFn.id,
            isDefault: false,
            isNamespace: false,
          },
          {
            kind: 'References',
            scopeId: importerFnScope.id,
            name: 'sharedValue',
            byteRange: byteRangeGet(30, 41),
            resolvedSymbolId: exportedFn.id,
            localSymbolId: importedBinding.id,
          },
          {
            kind: 'Calls',
            scopeId: importerFnScope.id,
            calleeName: 'sharedValue',
            byteRange: byteRangeGet(30, 41),
            resolvedSymbolId: exportedFn.id,
          },
        ],
      }),
    );

    const snapshot = projectIndexStoreSnapshotCreate(store, defaultCapabilities);
    const restored = projectIndexStoreRestore(snapshot);
    const index = projectIndexCreate(restored.store, defaultCapabilities);

    expect(index.fileExportsGet(exporterFile)).toEqual([
      expect.objectContaining({
        exportedName: 'sharedValue',
        symbolId: exportedFn.id,
      }),
    ]);
    expect(index.importBindingsGet(importerFile)).toEqual([
      expect.objectContaining({
        localSymbolId: importedBinding.id,
        resolvedExportId: exportedFn.id,
      }),
    ]);
    expect(index.moduleImportersGet(exporterFile)).toEqual([importerFile]);
    expect(index.calleesGet(callerFn.id)).toEqual([exportedFn.id]);
    expect(index.callersGet(exportedFn.id)).toEqual([callerFn.id]);
  });
});

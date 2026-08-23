import type { ProjectIndex } from './indexQuery';
import { projectIndexCreate } from './indexQuery';
import type { IndexStore, FileIndexDelta } from './indexStore';
import { indexStoreNew } from './indexStore';
import type {
  CallsRelation,
  ExportsRelation,
  FlowGraph,
  ImportBindingRelation,
  ImportsRelation,
  IndexCapabilities,
  RelationRecord,
  ReferencesRelation,
  ScopeRecord,
  SymbolRecord,
  TypeRelation,
} from './indexTypes';

/**
 * JSON-serializable snapshot of the project index for subprocess plugins.
 * Plugins running out-of-process can query this raw data using their own
 * language/runtime instead of depending on the in-process `ProjectIndex` API.
 */
export type ProjectIndexSnapshot = {
  capabilities: IndexCapabilities;
  files: string[];
  symbols: SymbolRecord[];
  scopes: ScopeRecord[];
  references: ReferencesRelation[];
  imports: ImportsRelation[];
  importBindings: ImportBindingRelation[];
  exports: ExportsRelation[];
  typeRelations: TypeRelation[];
  cfgsByScopeId: Record<string, FlowGraph>;
  moduleImportersByFile: Record<string, string[]>;
  moduleImporteesByFile: Record<string, string[]>;
  moduleDependencyOrder: string[];
  moduleCycles: string[][];
  moduleEntryPoints: string[];
};

/**
 * JSON-serializable snapshot of the underlying index-store facts.
 * This preserves enough data to reconstruct the in-process `ProjectIndex`
 * and continue incremental updates after restore.
 */
export type ProjectIndexStoreSnapshot = {
  capabilities: IndexCapabilities;
  files: Array<{
    file: string;
    revision: string;
    symbols: SymbolRecord[];
    scopes: ScopeRecord[];
    relations: RelationRecord[];
    cfgs?: FlowGraph[];
  }>;
};

/**
 * Materialize the public query API into plain JSON-friendly data structures.
 */
export function projectIndexSnapshotCreate(index: ProjectIndex): ProjectIndexSnapshot {
  const files = index.filesGet();
  const scopes = files.flatMap((file) => index.scopesInFileGet(file));
  const cfgsByScopeId: Record<string, FlowGraph> = {};
  for (const scope of scopes) {
    const cfg = index.cfgGet(scope.id);
    if (cfg) {
      cfgsByScopeId[scope.id] = cfg;
    }
  }

  const moduleImportersByFile: Record<string, string[]> = {};
  const moduleImporteesByFile: Record<string, string[]> = {};
  for (const file of files) {
    moduleImportersByFile[file] = index.moduleImportersGet(file);
    moduleImporteesByFile[file] = index.moduleImporteesGet(file);
  }

  return {
    capabilities: index.capabilities,
    files,
    symbols: index.symbolsGet(),
    scopes,
    references: files.flatMap((file) => index.referencesInFileGet(file)),
    imports: files.flatMap((file) => index.importsGet(file)),
    importBindings: files.flatMap((file) => index.importBindingsGet(file)),
    exports: files.flatMap((file) => index.fileExportsGet(file)),
    typeRelations: files.flatMap((file) => index.typeRelationsInFileGet(file)),
    cfgsByScopeId,
    moduleImportersByFile,
    moduleImporteesByFile,
    moduleDependencyOrder: index.moduleDependencyOrderGet(),
    moduleCycles: index.moduleCyclesGet(),
    moduleEntryPoints: index.moduleEntryPointsGet(),
  };
}

/**
 * Materialize the underlying store facts into per-file deltas that can be restored later.
 */
export function projectIndexStoreSnapshotCreate(
  store: IndexStore,
  capabilities: IndexCapabilities,
): ProjectIndexStoreSnapshot {
  return {
    capabilities,
    files: store.filesGet().map((file) => {
      const scopes = store.scopesInFileGet(file);
      const calls: CallsRelation[] = scopes.flatMap((scope) => store.callsInScopeGet(scope.id));
      return {
        file,
        revision: store.fileRevisionGet(file) ?? 'snapshot',
        symbols: store.symbolsGet({ file }),
        scopes,
        relations: [
          ...store.referencesInFileGet(file),
          ...calls,
          ...store.importsInFileGet(file),
          ...store.importBindingsInFileGet(file),
          ...store.exportsInFileGet(file),
          ...store.typeRelationsInFileGet(file),
          // Symbol-flow and member-shape relations are part of the store's
          // relation set, so they must round-trip too. Omitting them silently
          // empties `querySymbolFlow` and structural type-hierarchy matches for
          // every consumer that restores from a snapshot — the subprocess index
          // build host and the warm cache both do.
          ...store.memberShapesInFileGet(file),
          ...store.symbolFlowsInFileGet(file),
        ],
        cfgs: store.cfgsInFileGet(file),
      };
    }),
  };
}

/**
 * Rebuild an `IndexStore` from a previously captured store snapshot.
 */
export function projectIndexStoreRestore(
  snapshot: ProjectIndexStoreSnapshot,
): {
  store: IndexStore;
  index: ProjectIndex;
} {
  const store = indexStoreNew();
  for (const file of snapshot.files) {
    const delta: FileIndexDelta = {
      file: file.file,
      revision: file.revision,
      symbols: file.symbols,
      scopes: file.scopes,
      relations: file.relations,
      cfgs: file.cfgs,
    };
    store.filePut(delta);
  }
  return {
    store,
    index: projectIndexCreate(store, snapshot.capabilities),
  };
}

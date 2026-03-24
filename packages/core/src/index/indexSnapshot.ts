import type { ProjectIndex } from './indexQuery';
import type {
  ExportsRelation,
  FlowGraph,
  ImportBindingRelation,
  ImportsRelation,
  IndexCapabilities,
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

/**
 * @packageDocumentation
 * Public query API for the semantic index.
 *
 * This is the stable API that plugins use to query project-wide information.
 * All queries are total (return empty arrays, not null) and read-only.
 */

import type {
  SymbolId,
  ScopeId,
  SymbolRecord,
  ScopeRecord,
  SymbolFilter,
  IndexCapabilities,
  ReferencesRelation,
  ImportsRelation,
  ImportBindingRelation,
  ExportsRelation,
  TypeRelation,
  FlowGraph,
} from './indexTypes';
import type { IndexStore } from './indexStore';
import type { ModuleGraph } from './moduleGraph';
import { moduleGraphBuild } from './moduleGraph';

// ============================================================================
// ProjectIndex Interface
// ============================================================================

/**
 * Public query interface for the semantic index.
 * This is the stable API exposed to plugins for cross-file analysis.
 *
 * Design principles:
 * - All queries are total (return empty arrays, never null)
 * - Read-only (no mutation methods exposed)
 * - Language-agnostic (no AST nodes or compiler internals)
 */
export type ProjectIndex = {
  // ============================================================================
  // Symbol Queries
  // ============================================================================

  /**
   * Get all symbols matching the filter.
   * Returns empty array if no matches.
   */
  symbolsGet(filter?: SymbolFilter): SymbolRecord[];

  /**
   * Get a symbol by its stable ID.
   * Returns undefined if not found.
   */
  symbolGet(id: SymbolId): SymbolRecord | undefined;

  /**
   * Get all symbols in a file.
   */
  symbolsInFileGet(file: string): SymbolRecord[];

  /**
   * Get all symbols with a specific name (across all files).
   */
  symbolsGetByName(name: string): SymbolRecord[];

  // ============================================================================
  // Reference Queries
  // ============================================================================

  /**
   * Get all references to a symbol.
   * Returns empty array if symbol has no references.
   */
  referencesGet(symbolId: SymbolId): ReferencesRelation[];

  /**
   * Get all references in a file.
   */
  referencesInFileGet(file: string): ReferencesRelation[];

  // ============================================================================
  // Call Graph Queries (heuristic)
  // ============================================================================

  /**
   * Get symbols that call a given symbol.
   * Based on heuristic call detection; may have false positives/negatives.
   */
  callersGet(symbolId: SymbolId): SymbolId[];

  /**
   * Get symbols called by a given symbol (function/method).
   * Based on heuristic call detection; may have false positives/negatives.
   */
  calleesGet(symbolId: SymbolId): SymbolId[];

  // ============================================================================
  // Scope Queries
  // ============================================================================

  /**
   * Get a scope by its stable ID.
   */
  scopeGet(id: ScopeId): ScopeRecord | undefined;

  /**
   * Get all scopes in a file.
   */
  scopesInFileGet(file: string): ScopeRecord[];

  /**
   * Get all symbols defined in a scope.
   */
  symbolsInScopeGet(scopeId: ScopeId): SymbolRecord[];

  // ============================================================================
  // Import/Export Queries
  // ============================================================================

  /**
   * Get all imports in a file.
   */
  importsGet(file: string): ImportsRelation[];

  /**
   * Get all import bindings in a file.
   * Import bindings contain detailed information about each imported name.
   */
  importBindingsGet(file: string): ImportBindingRelation[];

  /**
   * Get the import binding for a symbol (if it was imported).
   */
  importBindingGetForSymbol(symbolId: SymbolId): ImportBindingRelation | undefined;

  /**
   * Get all symbols that are exported (have Exported flag).
   */
  exportedSymbolsGet(filter?: { file?: string; name?: string }): SymbolRecord[];

  /**
   * Get symbols that export a given name.
   * Useful for resolving imports across files.
   */
  exportersGet(symbolName: string): SymbolRecord[];

  /**
   * Get all exports from a file.
   */
  fileExportsGet(file: string): ExportsRelation[];

  /**
   * Find where a symbol is exported from.
   * Returns the files and exported names for this symbol.
   */
  exportLocationsGet(symbolId: SymbolId): { file: string; exportedName: string }[];

  /**
   * Resolve an import to its target symbol.
   * Uses the cross-file resolution data if available.
   *
   * @param fromFile - The file containing the import
   * @param specifier - The module specifier (e.g., './utils')
   * @param name - The imported name (or 'default' for default imports)
   * @returns The resolved symbol ID, or undefined if not resolved
   */
  importResolve(fromFile: string, specifier: string, name: string): SymbolId | undefined;

  // ============================================================================
  // Type Relation Queries
  // ============================================================================

  /**
   * Get type relations for a symbol (what it extends/implements).
   * Returns empty array if symbol has no type relations.
   */
  typeRelationsGet(symbolId: SymbolId): TypeRelation[];

  /**
   * Get symbols that extend/implement a given symbol (reverse lookup).
   * Uses the symbol's name to find children, then filters by resolvedTargetId
   * when available for precision.
   */
  subTypesGet(symbolId: SymbolId): TypeRelation[];

  /**
   * Get all type relations in a file.
   */
  typeRelationsInFileGet(file: string): TypeRelation[];

  // ============================================================================
  // Module Graph Queries
  // ============================================================================

  /**
   * Get files that import the given file (reverse dependency edges).
   * Only includes indexed files; external packages are excluded.
   */
  moduleImportersGet(file: string): string[];

  /**
   * Get files that the given file imports (forward dependency edges).
   * Only includes indexed files; external packages are excluded.
   */
  moduleImporteesGet(file: string): string[];

  /**
   * Get all indexed files in dependency order (topological sort).
   * Files with no dependencies come first; dependents come after their dependencies.
   * Files in cycles are included with arbitrary intra-cycle ordering.
   */
  moduleDependencyOrderGet(): string[];

  /**
   * Get all circular dependency cycles.
   * Each cycle is an array of file paths. Returns empty array if no cycles exist.
   */
  moduleCyclesGet(): string[][];

  /**
   * Get all entry point files (files with no importers within the indexed set).
   * These are root files that nothing else depends on.
   * Sorted alphabetically for determinism.
   */
  moduleEntryPointsGet(): string[];

  // ============================================================================
  // Control Flow Graph Queries
  // ============================================================================

  /**
   * Get the control flow graph for a scope.
   * Returns undefined if no CFG is available (scope is not a function, or
   * CFGs were not extracted).
   */
  cfgGet(scopeId: ScopeId): FlowGraph | undefined;

  /**
   * Get the cyclomatic complexity of a function/method symbol.
   * Computed as V(G) = E - N + 2 where E = edges, N = nodes.
   * Returns undefined if the symbol has no associated CFG.
   */
  cyclomaticComplexityGet(symbolId: SymbolId): number | undefined;

  // ============================================================================
  // Metadata
  // ============================================================================

  /**
   * Get the capabilities of this index.
   * Plugins should check this before attempting advanced queries.
   */
  readonly capabilities: IndexCapabilities;

  /**
   * Get all indexed file paths.
   */
  filesGet(): string[];

  /**
   * Get statistics about the index.
   */
  statsGet(): {
    files: number;
    symbols: number;
    scopes: number;
    relations: number;
  };
};

// ============================================================================
// ProjectIndex Implementation
// ============================================================================

/**
 * Create a ProjectIndex from an IndexStore.
 * This wraps the store in a read-only query interface.
 */
export function projectIndexCreate(
  store: IndexStore,
  capabilities: IndexCapabilities
): ProjectIndex {
  // Lazily built module graph (cached after first access)
  let graph: ModuleGraph | undefined;

  return {
    // Symbol queries
    symbolsGet(filter?: SymbolFilter): SymbolRecord[] {
      return store.symbolsGet(filter);
    },

    symbolGet(id: SymbolId): SymbolRecord | undefined {
      return store.symbolGet(id);
    },

    symbolsInFileGet(file: string): SymbolRecord[] {
      return store.symbolsGet({ file });
    },

    symbolsGetByName(name: string): SymbolRecord[] {
      return store.symbolsGet({ name });
    },

    // Reference queries
    referencesGet(symbolId: SymbolId): ReferencesRelation[] {
      return store.referencesGet(symbolId);
    },

    referencesInFileGet(file: string): ReferencesRelation[] {
      return store.referencesInFileGet(file);
    },

    // Call graph queries
    callersGet(symbolId: SymbolId): SymbolId[] {
      // Find all Calls relations that resolved to this symbol
      const calls = store.callsGet();
      const callerScopes = new Set<ScopeId>();

      for (const call of calls) {
        if (call.resolvedSymbolId === symbolId) {
          callerScopes.add(call.scopeId);
        }
      }

      // Map scopes to their containing function/method symbols
      const callers: SymbolId[] = [];
      for (const scopeId of callerScopes) {
        // Find function/method symbol that owns this scope
        const scope = store.scopeGet(scopeId);
        if (!scope) continue;

        // Walk up to find enclosing function scope
        let current: ScopeRecord | undefined = scope;
        while (current) {
          if (current.kind === 'function') {
            // Find the function/method symbol whose declaration range contains
            // this function scope. We search by file (not by scopeId) because
            // function symbols are scoped to their own function scope, not to
            // the parent scope where the function is declared.
            const fileSymbols = store.symbolsGet({ file: scope.file });
            for (const sym of fileSymbols) {
              if (
                (sym.kind === 'function' || sym.kind === 'method') &&
                sym.byteRange.start <= current.byteRange.start &&
                sym.byteRange.end >= current.byteRange.end
              ) {
                callers.push(sym.id);
                break;
              }
            }
            break;
          }
          if (current.parent) {
            current = store.scopeGet(current.parent);
          } else {
            break;
          }
        }
      }

      return [...new Set(callers)];
    },

    calleesGet(symbolId: SymbolId): SymbolId[] {
      const symbol = store.symbolGet(symbolId);
      if (!symbol) return [];

      // Only functions/methods have callees
      if (symbol.kind !== 'function' && symbol.kind !== 'method') {
        return [];
      }

      // Find scopes that belong to this symbol
      const fileScopess = store.scopesInFileGet(symbol.file);
      const relevantScopes: ScopeId[] = [];

      for (const scope of fileScopess) {
        // Check if scope is within symbol's range
        if (
          scope.byteRange.start >= symbol.byteRange.start &&
          scope.byteRange.end <= symbol.byteRange.end
        ) {
          relevantScopes.push(scope.id);
        }
      }

      // Get all calls within these scopes
      const callees = new Set<SymbolId>();
      for (const scopeId of relevantScopes) {
        const calls = store.callsInScopeGet(scopeId);
        for (const call of calls) {
          if (call.resolvedSymbolId) {
            callees.add(call.resolvedSymbolId);
          }
        }
      }

      return [...callees];
    },

    // Scope queries
    scopeGet(id: ScopeId): ScopeRecord | undefined {
      return store.scopeGet(id);
    },

    scopesInFileGet(file: string): ScopeRecord[] {
      return store.scopesInFileGet(file);
    },

    symbolsInScopeGet(scopeId: ScopeId): SymbolRecord[] {
      return store.symbolsInScopeGet(scopeId);
    },

    // Import/export queries
    importsGet(file: string): ImportsRelation[] {
      return store.importsInFileGet(file);
    },

    importBindingsGet(file: string): ImportBindingRelation[] {
      return store.importBindingsInFileGet(file);
    },

    importBindingGetForSymbol(symbolId: SymbolId): ImportBindingRelation | undefined {
      return store.importBindingForSymbolGet(symbolId);
    },

    exportedSymbolsGet(filter?: { file?: string; name?: string }): SymbolRecord[] {
      const symbols = store.symbolsGet(filter);
      // SymbolFlags.Exported = 1
      return symbols.filter(s => (s.flags & 1) !== 0);
    },

    exportersGet(symbolName: string): SymbolRecord[] {
      const symbols = store.symbolsGet({ name: symbolName });
      // SymbolFlags.Exported = 1
      return symbols.filter(s => (s.flags & 1) !== 0);
    },

    fileExportsGet(file: string): ExportsRelation[] {
      return store.exportsInFileGet(file);
    },

    exportLocationsGet(symbolId: SymbolId): { file: string; exportedName: string }[] {
      const results: { file: string; exportedName: string }[] = [];
      const exports = store.exportsGet();
      
      for (const exp of exports) {
        if (exp.symbolId === symbolId) {
          // Get the file from the symbol
          const symbol = store.symbolGet(symbolId);
          if (symbol) {
            results.push({
              file: symbol.file,
              exportedName: exp.exportedName,
            });
          }
        }
      }
      
      return results;
    },

    importResolve(fromFile: string, specifier: string, name: string): SymbolId | undefined {
      const bindings = store.importBindingsInFileGet(fromFile);
      
      for (const binding of bindings) {
        if (binding.moduleSpec !== specifier) continue;
        
        // Match by imported name
        const isDefaultMatch = name === 'default' && binding.isDefault;
        const isNamedMatch = !binding.isDefault && !binding.isNamespace && binding.importedName === name;
        
        if (isDefaultMatch || isNamedMatch) {
          return binding.resolvedExportId;
        }
      }
      
      return undefined;
    },

    // Type relation queries
    typeRelationsGet(symbolId: SymbolId): TypeRelation[] {
      return store.typeRelationsForSymbolGet(symbolId);
    },

    subTypesGet(symbolId: SymbolId): TypeRelation[] {
      const symbol = store.symbolGet(symbolId);
      if (!symbol) return [];

      // Look up by target name
      const byName = store.typeRelationsByTargetNameGet(symbol.name);
      // When resolvedTargetId is available, filter for exact match;
      // otherwise include all name-based matches
      return byName.filter(
        rel => rel.resolvedTargetId === symbolId || rel.resolvedTargetId === undefined
      );
    },

    typeRelationsInFileGet(file: string): TypeRelation[] {
      return store.typeRelationsInFileGet(file);
    },

    // Module graph queries (lazily built, cached)
    moduleImportersGet(file: string): string[] {
      if (!graph) graph = moduleGraphBuild(store);
      return graph.moduleGraphImportersGet(file);
    },

    moduleImporteesGet(file: string): string[] {
      if (!graph) graph = moduleGraphBuild(store);
      return graph.moduleGraphImporteesGet(file);
    },

    moduleDependencyOrderGet(): string[] {
      if (!graph) graph = moduleGraphBuild(store);
      return graph.moduleGraphDependencyOrderGet();
    },

    moduleCyclesGet(): string[][] {
      if (!graph) graph = moduleGraphBuild(store);
      return graph.moduleGraphCyclesGet();
    },

    moduleEntryPointsGet(): string[] {
      if (!graph) graph = moduleGraphBuild(store);
      return graph.moduleGraphEntryPointsGet();
    },

    // Control flow graph queries
    cfgGet(scopeId: ScopeId): FlowGraph | undefined {
      return store.cfgGet(scopeId);
    },

    cyclomaticComplexityGet(symbolId: SymbolId): number | undefined {
      // Find the function symbol
      const symbol = store.symbolGet(symbolId);
      if (!symbol) return undefined;

      // Find scopes in the same file that are function scopes
      // containing this symbol's byte range
      const scopes = store.scopesInFileGet(symbol.file);
      let targetScope: { id: string; byteRange: { start: number; end: number } } | undefined;
      let bestSize = Infinity;

      for (const scope of scopes) {
        if (scope.kind === 'function' &&
            scope.byteRange.start <= symbol.byteRange.start &&
            scope.byteRange.end >= symbol.byteRange.end) {
          const size = scope.byteRange.end - scope.byteRange.start;
          if (size < bestSize) {
            targetScope = scope;
            bestSize = size;
          }
        }
      }

      if (!targetScope) return undefined;

      const cfg = store.cfgGet(targetScope.id);
      if (!cfg) return undefined;

      // V(G) = E - N + 2
      const E = cfg.edges.length;
      const N = cfg.nodes.length;
      return E - N + 2;
    },

    // Metadata
    capabilities,

    filesGet() {
      return store.filesGet();
    },

    statsGet() {
      return store.statsGet();
    },
  };
}

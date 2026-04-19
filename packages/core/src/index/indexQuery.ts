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
  MemberShapeRelation,
  SymbolFlowRelation,
  FlowGraph,
} from './indexTypes';
import type { IndexStore } from './indexStore';
import type { ModuleEdgeInfo, ModuleGraph, ModuleGraphEdgeInfo } from './moduleGraph';
import { moduleGraphBuild, moduleGraphEdgeInfoBuild } from './moduleGraph';

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
   * Resolve a symbol id to its canonical declaration id.
   *
   * When `symbolId` is a local import-binding symbol (the local handle
   * created by `import { foo } from './a'`), this follows the binding's
   * `resolvedExportId` until a declaration is reached and returns the
   * canonical declaration's id. When `symbolId` already names a
   * declaration the input is returned unchanged.
   *
   * Idempotent and cycle-safe: a symbol that participates in a
   * pathological re-export cycle terminates by visited-set tracking
   * and returns the last symbol the chain produced.
   *
   * Used by `callersGet` and `calleesGet` to normalize re-export proxy
   * ids so the call graph collapses to one node per logical
   * declaration. Callers that want the un-normalized chain (e.g., to
   * enumerate "every file that re-exports `helper`") should use
   * `exportLocationsGet` against the canonical id.
   */
  symbolCanonicalIdGet(symbolId: SymbolId): SymbolId;

  /**
   * Get symbols that call a given symbol.
   *
   * Both the input and the resulting caller ids are normalized through
   * {@link symbolCanonicalIdGet} so the result is one entry per logical
   * declaration regardless of how many re-export hops the call site
   * traversed.
   *
   * Heuristic: dynamic dispatch and higher-order calls are not tracked.
   */
  callersGet(symbolId: SymbolId): SymbolId[];

  /**
   * Get symbols called by a given symbol (function/method).
   *
   * Both the input and the resulting callee ids are normalized through
   * {@link symbolCanonicalIdGet} so re-export proxies collapse onto the
   * canonical declaration.
   *
   * Heuristic: dynamic dispatch and higher-order calls are not tracked.
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
   *
   * Default behavior (no `opts` or `confidence === 'declared'`):
   * returns only relations whose `confidence` is undefined or
   * `'declared'`. Byte-identical to the pre-Phase-9.4 result for every
   * fixture.
   *
   * With `opts.confidence === 'all'`: also returns relations whose
   * `confidence === 'structural-shape'` (produced by the cross-file
   * structural-shape comparison pass added in Phase 9.4).
   *
   * Returns empty array if the symbol has no type relations.
   */
  typeRelationsGet(
    symbolId: SymbolId,
    opts?: { confidence?: 'declared' | 'all' },
  ): TypeRelation[];

  /**
   * Get symbols that extend/implement a given symbol (reverse lookup).
   * Uses the symbol's name to find children, then filters by resolvedTargetId
   * when available for precision.
   *
   * Default behavior (no `opts` or `confidence === 'declared'`):
   * returns only relations whose `confidence` is undefined or
   * `'declared'`. Byte-identical to the pre-Phase-9.4 result for every
   * fixture.
   *
   * With `opts.confidence === 'all'`: also returns relations whose
   * `confidence === 'structural-shape'`. Sorted lexicographically by
   * `(symbolId, resolvedTargetId)` for determinism.
   */
  subTypesGet(
    symbolId: SymbolId,
    opts?: { confidence?: 'declared' | 'all' },
  ): TypeRelation[];

  /**
   * Get all type relations in a file.
   */
  typeRelationsInFileGet(file: string): TypeRelation[];

  /**
   * Get the captured public-member shape of a class / interface /
   * type-alias-of-object (Phase 9.4 / Gap 3). Returns `undefined`
   * when the language pack does not extract member shapes for the
   * symbol's language, or the symbol is not a shape owner.
   */
  memberShapeForSymbolGet(symbolId: SymbolId): MemberShapeRelation | undefined;

  /**
   * Get every member shape whose owner declaration lives in `file`.
   * Returns empty array when the file has no shape-bearing owners.
   */
  memberShapesInFileGet(file: string): MemberShapeRelation[];

  // ============================================================================
  // Symbol-Flow Queries (Phase 9.1: higher-order argument flow)
  // ============================================================================

  /**
   * Get every flow site where the given function/method symbol appears
   * as a value (e.g. passed as an argument). Returns empty when the
   * symbol does not flow anywhere or is not a function/method.
   *
   * Distinct from {@link callersGet}: a flow site is *not* a call site.
   * The two surfaces answer different questions and must not be merged
   * in the structural call graph.
   */
  symbolFlowsForSymbolGet(symbolId: SymbolId): SymbolFlowRelation[];

  /**
   * Get every flow site whose receiving call resolved to the given
   * function/method symbol — answers "which functions are passed to
   * this one?". Returns empty when the receiver is not the target of
   * any indexed flow or is not a function/method.
   */
  symbolFlowsForReceiverGet(receivingCallSymbolId: SymbolId): SymbolFlowRelation[];

  /**
   * Get all symbol-flow relations whose flow site lives in the given file.
   */
  symbolFlowsInFileGet(file: string): SymbolFlowRelation[];

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

  /**
   * Get per-edge metadata for a directed file→file edge in the module
   * dependency graph. Returns `undefined` when no such edge exists.
   *
   * Meant for consumers (workspace-service, architecture rules) that need
   * to distinguish static, dynamic, CommonJS, and side-effect imports
   * without reaching into the underlying relation records.
   */
  moduleEdgeInfoGet(from: string, to: string): ModuleEdgeInfo | undefined;

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
  let edgeInfo: ModuleGraphEdgeInfo | undefined;

  // Cache for `symbolCanonicalIdGet`. Populated on first use per
  // ProjectIndex instance; the cache is discarded with the instance,
  // which the workspace service rebuilds on every store mutation.
  const canonicalIdCache = new Map<SymbolId, SymbolId>();

  function symbolCanonicalIdResolve(symbolId: SymbolId): SymbolId {
    const cached = canonicalIdCache.get(symbolId);
    if (cached !== undefined) return cached;

    // Walk the import-binding chain. Every step rewrites `current` to
    // the binding's `resolvedExportId`, which is already the
    // collapsed-chain canonical id (`exportMapAddReexportedSymbols`
    // ran during cross-file resolve and resolved re-export hops to the
    // origin declaration). The `while` loop is therefore at most one
    // hop in the common case; the visited set is belt-and-suspenders
    // for pathological inputs (e.g., a binding that points back at
    // itself when the source module is unindexed and the resolution
    // produced a self-loop).
    const visited: SymbolId[] = [];
    let current = symbolId;
    while (!canonicalIdCache.has(current)) {
      visited.push(current);
      const binding = store.importBindingForSymbolGet(current);
      const next = binding?.resolvedExportId;
      if (!next || next === current) break;
      if (visited.includes(next)) break;
      current = next;
    }
    const canonical = canonicalIdCache.get(current) ?? current;
    for (const id of visited) {
      canonicalIdCache.set(id, canonical);
    }
    return canonical;
  }

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

    // Symbol canonical-id (re-export chain follower)
    symbolCanonicalIdGet(symbolId: SymbolId): SymbolId {
      return symbolCanonicalIdResolve(symbolId);
    },

    // Call graph queries
    callersGet(symbolId: SymbolId): SymbolId[] {
      // Normalize the focus id so callers that pass a local re-export
      // proxy (e.g., the import-binding symbol in `c.ts` for `helper`)
      // see the same callers as callers that passed the canonical
      // declaration id.
      const canonicalFocus = symbolCanonicalIdResolve(symbolId);

      // Find all Calls relations that resolve (after canonicalization)
      // to this symbol. Cross-file resolve in `crossFileResolve` already
      // rewrites `Calls.resolvedSymbolId` to the canonical declaration
      // for the common single-hop case, but we re-canonicalize defensively
      // so the helper is correct against snapshots / partial rebuilds
      // that pre-date the rewrite.
      const calls = store.callsGet();
      const callerScopes = new Set<ScopeId>();

      for (const call of calls) {
        if (!call.resolvedSymbolId) continue;
        if (symbolCanonicalIdResolve(call.resolvedSymbolId) !== canonicalFocus) continue;
        callerScopes.add(call.scopeId);
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
                callers.push(symbolCanonicalIdResolve(sym.id));
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
      // Normalize so callers that pass a re-export proxy id get the
      // same callees as callers that pass the canonical declaration.
      const canonicalFocus = symbolCanonicalIdResolve(symbolId);
      const symbol = store.symbolGet(canonicalFocus);
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

      // Get all calls within these scopes; canonicalize each callee so
      // the result has one entry per logical declaration, regardless of
      // whether the call site resolved through a re-export hop.
      const callees = new Set<SymbolId>();
      for (const scopeId of relevantScopes) {
        const calls = store.callsInScopeGet(scopeId);
        for (const call of calls) {
          if (call.resolvedSymbolId) {
            callees.add(symbolCanonicalIdResolve(call.resolvedSymbolId));
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
    typeRelationsGet(
      symbolId: SymbolId,
      opts?: { confidence?: 'declared' | 'all' },
    ): TypeRelation[] {
      const all = store.typeRelationsForSymbolGet(symbolId);
      // Default and explicit `'declared'`: drop structural-shape
      // relations so today's output is preserved byte-identically.
      const wantsAll = opts?.confidence === 'all';
      if (wantsAll) return all;
      return all.filter(
        (rel) => rel.confidence === undefined || rel.confidence === 'declared',
      );
    },

    subTypesGet(
      symbolId: SymbolId,
      opts?: { confidence?: 'declared' | 'all' },
    ): TypeRelation[] {
      const symbol = store.symbolGet(symbolId);
      if (!symbol) return [];

      const wantsAll = opts?.confidence === 'all';

      // Declared subtypes: name-keyed lookup, filtered to those that
      // either resolved to this exact symbol or did not resolve at all
      // (the historical heuristic preserved verbatim — changing it
      // would break callers who pass no `opts`).
      const declared = store
        .typeRelationsByTargetNameGet(symbol.name)
        .filter(
          (rel) => rel.resolvedTargetId === symbolId || rel.resolvedTargetId === undefined,
        )
        .filter(
          (rel) => rel.confidence === undefined || rel.confidence === 'declared',
        );

      if (!wantsAll) return declared;

      // Structural-shape subtypes are produced by `crossFileResolve`
      // and stored on the per-symbol bucket of the implementer (the
      // class), keyed by `targetName === interface.name`. Look them up
      // through the same name index, but accept only relations that
      // resolved to *this* interface symbol (the cross-file pass
      // always sets `resolvedTargetId` for shape-match output).
      const structural = store
        .typeRelationsByTargetNameGet(symbol.name)
        .filter(
          (rel) => rel.confidence === 'structural-shape' && rel.resolvedTargetId === symbolId,
        );

      const merged = [...declared, ...structural];
      // Determinism: sort lexicographically by `(symbolId, resolvedTargetId)`
      // so consumers iterating with `confidence: 'all'` see byte-identical
      // output across runs.
      merged.sort((left, right) => {
        if (left.symbolId !== right.symbolId) {
          return left.symbolId < right.symbolId ? -1 : 1;
        }
        const leftTarget = left.resolvedTargetId ?? '';
        const rightTarget = right.resolvedTargetId ?? '';
        if (leftTarget !== rightTarget) {
          return leftTarget < rightTarget ? -1 : 1;
        }
        return 0;
      });
      return merged;
    },

    typeRelationsInFileGet(file: string): TypeRelation[] {
      return store.typeRelationsInFileGet(file);
    },

    memberShapeForSymbolGet(symbolId: SymbolId): MemberShapeRelation | undefined {
      return store.memberShapeForSymbolGet(symbolId);
    },

    memberShapesInFileGet(file: string): MemberShapeRelation[] {
      return store.memberShapesInFileGet(file);
    },

    // Symbol-flow queries (Phase 9.1)
    symbolFlowsForSymbolGet(symbolId: SymbolId): SymbolFlowRelation[] {
      return store.symbolFlowsForFlowingSymbolGet(symbolId);
    },

    symbolFlowsForReceiverGet(receivingCallSymbolId: SymbolId): SymbolFlowRelation[] {
      return store.symbolFlowsForReceivingCallSymbolGet(receivingCallSymbolId);
    },

    symbolFlowsInFileGet(file: string): SymbolFlowRelation[] {
      return store.symbolFlowsInFileGet(file);
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

    moduleEdgeInfoGet(from: string, to: string): ModuleEdgeInfo | undefined {
      if (!edgeInfo) edgeInfo = moduleGraphEdgeInfoBuild(store);
      return edgeInfo.moduleEdgeInfoGet(from, to);
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

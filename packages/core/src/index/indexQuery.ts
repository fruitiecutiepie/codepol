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
} from './indexTypes';
import type { IndexStore } from './indexStore';

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
  getSymbols(filter?: SymbolFilter): SymbolRecord[];

  /**
   * Get a symbol by its stable ID.
   * Returns undefined if not found.
   */
  getSymbol(id: SymbolId): SymbolRecord | undefined;

  /**
   * Get all symbols in a file.
   */
  getSymbolsInFile(file: string): SymbolRecord[];

  /**
   * Get all symbols with a specific name (across all files).
   */
  getSymbolsByName(name: string): SymbolRecord[];

  // ============================================================================
  // Reference Queries
  // ============================================================================

  /**
   * Get all references to a symbol.
   * Returns empty array if symbol has no references.
   */
  getReferences(symbolId: SymbolId): ReferencesRelation[];

  /**
   * Get all references in a file.
   */
  getReferencesInFile(file: string): ReferencesRelation[];

  // ============================================================================
  // Call Graph Queries (heuristic)
  // ============================================================================

  /**
   * Get symbols that call a given symbol.
   * Based on heuristic call detection; may have false positives/negatives.
   */
  getCallers(symbolId: SymbolId): SymbolId[];

  /**
   * Get symbols called by a given symbol (function/method).
   * Based on heuristic call detection; may have false positives/negatives.
   */
  getCallees(symbolId: SymbolId): SymbolId[];

  // ============================================================================
  // Scope Queries
  // ============================================================================

  /**
   * Get a scope by its stable ID.
   */
  getScope(id: ScopeId): ScopeRecord | undefined;

  /**
   * Get all scopes in a file.
   */
  getScopesInFile(file: string): ScopeRecord[];

  /**
   * Get all symbols defined in a scope.
   */
  getSymbolsInScope(scopeId: ScopeId): SymbolRecord[];

  // ============================================================================
  // Import/Export Queries
  // ============================================================================

  /**
   * Get all imports in a file.
   */
  getImports(file: string): ImportsRelation[];

  /**
   * Get all import bindings in a file.
   * Import bindings contain detailed information about each imported name.
   */
  getImportBindings(file: string): ImportBindingRelation[];

  /**
   * Get the import binding for a symbol (if it was imported).
   */
  getImportBindingForSymbol(symbolId: SymbolId): ImportBindingRelation | undefined;

  /**
   * Get all symbols that are exported (have Exported flag).
   */
  getExportedSymbols(filter?: { file?: string; name?: string }): SymbolRecord[];

  /**
   * Get symbols that export a given name.
   * Useful for resolving imports across files.
   */
  getExporters(symbolName: string): SymbolRecord[];

  /**
   * Get all exports from a file.
   */
  getFileExports(file: string): ExportsRelation[];

  /**
   * Find where a symbol is exported from.
   * Returns the files and exported names for this symbol.
   */
  getExportLocations(symbolId: SymbolId): { file: string; exportedName: string }[];

  /**
   * Resolve an import to its target symbol.
   * Uses the cross-file resolution data if available.
   *
   * @param fromFile - The file containing the import
   * @param specifier - The module specifier (e.g., './utils')
   * @param name - The imported name (or 'default' for default imports)
   * @returns The resolved symbol ID, or undefined if not resolved
   */
  resolveImport(fromFile: string, specifier: string, name: string): SymbolId | undefined;

  // ============================================================================
  // Metadata
  // ============================================================================

  /**
   * Get the capabilities of this index.
   * Plugins should check this before attempting advanced queries.
   */
  readonly capabilities: IndexCapabilities;

  /**
   * Get statistics about the index.
   */
  getStats(): {
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
  return {
    // Symbol queries
    getSymbols(filter?: SymbolFilter): SymbolRecord[] {
      return store.symbolsGet(filter);
    },

    getSymbol(id: SymbolId): SymbolRecord | undefined {
      return store.symbolGet(id);
    },

    getSymbolsInFile(file: string): SymbolRecord[] {
      return store.symbolsGet({ file });
    },

    getSymbolsByName(name: string): SymbolRecord[] {
      return store.symbolsGet({ name });
    },

    // Reference queries
    getReferences(symbolId: SymbolId): ReferencesRelation[] {
      return store.referencesGet(symbolId);
    },

    getReferencesInFile(file: string): ReferencesRelation[] {
      return store.referencesInFileGet(file);
    },

    // Call graph queries
    getCallers(symbolId: SymbolId): SymbolId[] {
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
            // Find symbol at this scope
            const symbols = store.symbolsGet({ scopeId: current.parent });
            for (const sym of symbols) {
              if (
                (sym.kind === 'function' || sym.kind === 'method') &&
                sym.scopeId === current.parent
              ) {
                // Check if the symbol's range contains the scope's range
                if (
                  sym.range.start <= current.range.start &&
                  sym.range.end >= current.range.end
                ) {
                  callers.push(sym.id);
                  break;
                }
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

    getCallees(symbolId: SymbolId): SymbolId[] {
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
          scope.range.start >= symbol.range.start &&
          scope.range.end <= symbol.range.end
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
    getScope(id: ScopeId): ScopeRecord | undefined {
      return store.scopeGet(id);
    },

    getScopesInFile(file: string): ScopeRecord[] {
      return store.scopesInFileGet(file);
    },

    getSymbolsInScope(scopeId: ScopeId): SymbolRecord[] {
      return store.symbolsInScopeGet(scopeId);
    },

    // Import/export queries
    getImports(file: string): ImportsRelation[] {
      return store.importsInFileGet(file);
    },

    getImportBindings(file: string): ImportBindingRelation[] {
      return store.importBindingsInFileGet(file);
    },

    getImportBindingForSymbol(symbolId: SymbolId): ImportBindingRelation | undefined {
      return store.importBindingForSymbolGet(symbolId);
    },

    getExportedSymbols(filter?: { file?: string; name?: string }): SymbolRecord[] {
      const symbols = store.symbolsGet(filter);
      // SymbolFlags.Exported = 1
      return symbols.filter(s => (s.flags & 1) !== 0);
    },

    getExporters(symbolName: string): SymbolRecord[] {
      const symbols = store.symbolsGet({ name: symbolName });
      // SymbolFlags.Exported = 1
      return symbols.filter(s => (s.flags & 1) !== 0);
    },

    getFileExports(file: string): ExportsRelation[] {
      return store.exportsInFileGet(file);
    },

    getExportLocations(symbolId: SymbolId): { file: string; exportedName: string }[] {
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

    resolveImport(fromFile: string, specifier: string, name: string): SymbolId | undefined {
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

    // Metadata
    capabilities,

    getStats() {
      return store.statsGet();
    },
  };
}

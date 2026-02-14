/**
 * @packageDocumentation
 * In-memory storage for the semantic index.
 *
 * The IndexStore maintains:
 * - Primary storage for symbols, scopes, and relations
 * - Secondary indexes for efficient lookups
 * - File-keyed storage for incremental updates
 */

import type {
  SymbolId,
  ScopeId,
  SymbolRecord,
  ScopeRecord,
  RelationRecord,
  ReferencesRelation,
  CallsRelation,
  ImportsRelation,
  ImportBindingRelation,
  ExportsRelation,
  TypeRelation,
  FlowGraph,
} from './indexTypes';

// ============================================================================
// File Index Delta (per-file extraction result)
// ============================================================================

/**
 * Result of indexing a single file.
 * Produced by language adapters, consumed by IndexStore.
 */
export type FileIndexDelta = {
  /** Absolute file path */
  file: string;
  /** Revision identifier (e.g., content hash, timestamp) */
  revision: string;
  /** Symbols declared in this file */
  symbols: SymbolRecord[];
  /** Scopes in this file */
  scopes: ScopeRecord[];
  /** Relations extracted from this file */
  relations: RelationRecord[];
  /** Control flow graphs per function scope (optional) */
  cfgs?: FlowGraph[];
};

// ============================================================================
// Index Store
// ============================================================================

/**
 * In-memory store for the semantic index.
 * Provides efficient lookups via secondary indexes.
 */
export class IndexStore {
  // Primary storage
  private symbolsById = new Map<SymbolId, SymbolRecord>();
  private scopesById = new Map<ScopeId, ScopeRecord>();
  private relations: RelationRecord[] = [];

  // Secondary indexes for efficient lookups
  private symbolsByName = new Map<string, Set<SymbolId>>();
  private symbolsByFile = new Map<string, Set<SymbolId>>();
  private scopesByFile = new Map<string, Set<ScopeId>>();
  private symbolsByScope = new Map<ScopeId, Set<SymbolId>>();
  private childScopes = new Map<ScopeId, Set<ScopeId>>();

  // Relation indexes
  private referencesBySymbol = new Map<SymbolId, ReferencesRelation[]>();
  private referencesByFile = new Map<string, ReferencesRelation[]>();
  private callsByScope = new Map<ScopeId, CallsRelation[]>();
  private importsByFile = new Map<string, ImportsRelation[]>();

  // Cross-file resolution indexes
  private importBindingsByFile = new Map<string, ImportBindingRelation[]>();
  private importBindingsBySymbol = new Map<SymbolId, ImportBindingRelation>();
  private exportsByFile = new Map<string, ExportsRelation[]>();
  private exportsByName = new Map<string, Map<string, ExportsRelation>>(); // exportedName -> file -> export

  // Type relation indexes
  private typeRelationsBySymbol = new Map<SymbolId, TypeRelation[]>();
  private typeRelationsByTargetName = new Map<string, TypeRelation[]>();
  private typeRelationsByFile = new Map<string, TypeRelation[]>();

  // Control flow graph storage (per function scope)
  private cfgByScope = new Map<string, FlowGraph>();
  private cfgsByFile = new Map<string, FlowGraph[]>();

  // File revision tracking for incremental updates
  private fileRevisions = new Map<string, string>();

  // ============================================================================
  // Mutation Methods
  // ============================================================================

  /**
   * Insert or update file facts.
   * Removes existing facts for the file before inserting new ones.
   */
  filePut(delta: FileIndexDelta): void {
    // Remove existing data for this file
    this.fileRemove(delta.file);

    // Track revision
    this.fileRevisions.set(delta.file, delta.revision);

    // Insert symbols
    for (const symbol of delta.symbols) {
      this.symbolsById.set(symbol.id, symbol);

      // Index by name
      let byName = this.symbolsByName.get(symbol.name);
      if (!byName) {
        byName = new Set();
        this.symbolsByName.set(symbol.name, byName);
      }
      byName.add(symbol.id);

      // Index by file
      let byFile = this.symbolsByFile.get(symbol.file);
      if (!byFile) {
        byFile = new Set();
        this.symbolsByFile.set(symbol.file, byFile);
      }
      byFile.add(symbol.id);

      // Index by scope
      let byScope = this.symbolsByScope.get(symbol.scopeId);
      if (!byScope) {
        byScope = new Set();
        this.symbolsByScope.set(symbol.scopeId, byScope);
      }
      byScope.add(symbol.id);
    }

    // Insert scopes
    for (const scope of delta.scopes) {
      this.scopesById.set(scope.id, scope);

      // Index by file
      let byFile = this.scopesByFile.get(scope.file);
      if (!byFile) {
        byFile = new Set();
        this.scopesByFile.set(scope.file, byFile);
      }
      byFile.add(scope.id);

      // Index child scopes
      if (scope.parent) {
        let children = this.childScopes.get(scope.parent);
        if (!children) {
          children = new Set();
          this.childScopes.set(scope.parent, children);
        }
        children.add(scope.id);
      }
    }

    // Insert relations
    for (const relation of delta.relations) {
      this.relations.push(relation);

      // Build relation-specific indexes
      if (relation.kind === 'References') {
        // Index by resolved symbol
        if (relation.resolvedSymbolId) {
          let refs = this.referencesBySymbol.get(relation.resolvedSymbolId);
          if (!refs) {
            refs = [];
            this.referencesBySymbol.set(relation.resolvedSymbolId, refs);
          }
          refs.push(relation);
        }

        // Index by file (via scope)
        const scope = this.scopesById.get(relation.scopeId);
        if (scope) {
          let refs = this.referencesByFile.get(scope.file);
          if (!refs) {
            refs = [];
            this.referencesByFile.set(scope.file, refs);
          }
          refs.push(relation);
        }
      } else if (relation.kind === 'Calls') {
        let calls = this.callsByScope.get(relation.scopeId);
        if (!calls) {
          calls = [];
          this.callsByScope.set(relation.scopeId, calls);
        }
        calls.push(relation);
      } else if (relation.kind === 'Imports') {
        const scope = this.scopesById.get(relation.scopeId);
        if (scope) {
          let imports = this.importsByFile.get(scope.file);
          if (!imports) {
            imports = [];
            this.importsByFile.set(scope.file, imports);
          }
          imports.push(relation);
        }
      } else if (relation.kind === 'ImportBinding') {
        // Index by file (derive file from the local symbol)
        const localSymbol = this.symbolsById.get(relation.localSymbolId);
        if (localSymbol) {
          let bindings = this.importBindingsByFile.get(localSymbol.file);
          if (!bindings) {
            bindings = [];
            this.importBindingsByFile.set(localSymbol.file, bindings);
          }
          bindings.push(relation);
        }
        // Index by local symbol
        this.importBindingsBySymbol.set(relation.localSymbolId, relation);
      } else if (relation.kind === 'Exports') {
        // Index by file (derive file from the symbol or store it directly)
        const symbol = relation.symbolId ? this.symbolsById.get(relation.symbolId) : undefined;
        const file = symbol?.file ?? delta.file;
        
        let exports = this.exportsByFile.get(file);
        if (!exports) {
          exports = [];
          this.exportsByFile.set(file, exports);
        }
        exports.push(relation);

        // Index by exported name for resolution
        let byName = this.exportsByName.get(relation.exportedName);
        if (!byName) {
          byName = new Map();
          this.exportsByName.set(relation.exportedName, byName);
        }
        byName.set(file, relation);
      } else if (relation.kind === 'TypeRelation') {
        // Index by child symbol
        let bySymbol = this.typeRelationsBySymbol.get(relation.symbolId);
        if (!bySymbol) {
          bySymbol = [];
          this.typeRelationsBySymbol.set(relation.symbolId, bySymbol);
        }
        bySymbol.push(relation);

        // Index by target name
        let byTarget = this.typeRelationsByTargetName.get(relation.targetName);
        if (!byTarget) {
          byTarget = [];
          this.typeRelationsByTargetName.set(relation.targetName, byTarget);
        }
        byTarget.push(relation);

        // Index by file (derive file from the child symbol)
        const childSym = this.symbolsById.get(relation.symbolId);
        if (childSym) {
          let byFile = this.typeRelationsByFile.get(childSym.file);
          if (!byFile) {
            byFile = [];
            this.typeRelationsByFile.set(childSym.file, byFile);
          }
          byFile.push(relation);
        }
      }
    }

    // Store control flow graphs
    if (delta.cfgs) {
      const fileCfgs: FlowGraph[] = [];
      for (const cfg of delta.cfgs) {
        this.cfgByScope.set(cfg.scopeId, cfg);
        fileCfgs.push(cfg);
      }
      if (fileCfgs.length > 0) {
        this.cfgsByFile.set(delta.file, fileCfgs);
      }
    }
  }

  /**
   * Remove all facts for a file.
   */
  fileRemove(file: string): void {
    // Get symbols to remove
    const symbolIds = this.symbolsByFile.get(file);
    if (symbolIds) {
      for (const id of symbolIds) {
        const symbol = this.symbolsById.get(id);
        if (symbol) {
          // Remove from name index
          const byName = this.symbolsByName.get(symbol.name);
          if (byName) {
            byName.delete(id);
            if (byName.size === 0) {
              this.symbolsByName.delete(symbol.name);
            }
          }

          // Remove from scope index
          const byScope = this.symbolsByScope.get(symbol.scopeId);
          if (byScope) {
            byScope.delete(id);
            if (byScope.size === 0) {
              this.symbolsByScope.delete(symbol.scopeId);
            }
          }

          // Remove references to this symbol
          this.referencesBySymbol.delete(id);
        }
        this.symbolsById.delete(id);
      }
      this.symbolsByFile.delete(file);
    }

    // Get scopes to remove
    const scopeIds = this.scopesByFile.get(file);
    if (scopeIds) {
      for (const id of scopeIds) {
        const scope = this.scopesById.get(id);
        if (scope && scope.parent) {
          const children = this.childScopes.get(scope.parent);
          if (children) {
            children.delete(id);
            if (children.size === 0) {
              this.childScopes.delete(scope.parent);
            }
          }
        }
        this.childScopes.delete(id);
        this.callsByScope.delete(id);
        this.scopesById.delete(id);
      }
      this.scopesByFile.delete(file);
    }

    // Remove file-indexed relations
    this.referencesByFile.delete(file);
    this.importsByFile.delete(file);

    // Remove import bindings for this file
    const importBindings = this.importBindingsByFile.get(file);
    if (importBindings) {
      for (const binding of importBindings) {
        this.importBindingsBySymbol.delete(binding.localSymbolId);
      }
      this.importBindingsByFile.delete(file);
    }

    // Remove exports for this file
    const exports = this.exportsByFile.get(file);
    if (exports) {
      for (const exp of exports) {
        const byName = this.exportsByName.get(exp.exportedName);
        if (byName) {
          byName.delete(file);
          if (byName.size === 0) {
            this.exportsByName.delete(exp.exportedName);
          }
        }
      }
      this.exportsByFile.delete(file);
    }

    // Remove type relations for this file
    const typeRels = this.typeRelationsByFile.get(file);
    if (typeRels) {
      for (const rel of typeRels) {
        // Remove from by-symbol index
        const bySymbol = this.typeRelationsBySymbol.get(rel.symbolId);
        if (bySymbol) {
          const idx = bySymbol.indexOf(rel);
          if (idx !== -1) bySymbol.splice(idx, 1);
          if (bySymbol.length === 0) this.typeRelationsBySymbol.delete(rel.symbolId);
        }

        // Remove from by-target index
        const byTarget = this.typeRelationsByTargetName.get(rel.targetName);
        if (byTarget) {
          const idx = byTarget.indexOf(rel);
          if (idx !== -1) byTarget.splice(idx, 1);
          if (byTarget.length === 0) this.typeRelationsByTargetName.delete(rel.targetName);
        }
      }
      this.typeRelationsByFile.delete(file);
    }

    // Remove relations from main array (rebuild without file's relations)
    if (scopeIds && scopeIds.size > 0) {
      this.relations = this.relations.filter(r => {
        if ('scopeId' in r) {
          return !scopeIds.has(r.scopeId);
        }
        // Also filter ImportBinding and Exports by checking their associated symbols
        if (r.kind === 'ImportBinding') {
          return !symbolIds?.has(r.localSymbolId);
        }
        if (r.kind === 'Exports') {
          return !symbolIds?.has(r.symbolId);
        }
        if (r.kind === 'TypeRelation') {
          return !symbolIds?.has(r.symbolId);
        }
        return true;
      });
    }

    // Remove control flow graphs for this file
    const fileCfgs = this.cfgsByFile.get(file);
    if (fileCfgs) {
      for (const cfg of fileCfgs) {
        this.cfgByScope.delete(cfg.scopeId);
      }
      this.cfgsByFile.delete(file);
    }

    // Remove revision tracking
    this.fileRevisions.delete(file);
  }

  /**
   * Clear all stored data.
   */
  clear(): void {
    this.symbolsById.clear();
    this.scopesById.clear();
    this.relations = [];
    this.symbolsByName.clear();
    this.symbolsByFile.clear();
    this.scopesByFile.clear();
    this.symbolsByScope.clear();
    this.childScopes.clear();
    this.referencesBySymbol.clear();
    this.referencesByFile.clear();
    this.callsByScope.clear();
    this.importsByFile.clear();
    this.importBindingsByFile.clear();
    this.importBindingsBySymbol.clear();
    this.exportsByFile.clear();
    this.exportsByName.clear();
    this.typeRelationsBySymbol.clear();
    this.typeRelationsByTargetName.clear();
    this.typeRelationsByFile.clear();
    this.cfgByScope.clear();
    this.cfgsByFile.clear();
    this.fileRevisions.clear();
  }

  // ============================================================================
  // Query Methods (used by indexQuery.ts)
  // ============================================================================

  /**
   * Get a symbol by ID.
   */
  symbolGet(id: SymbolId): SymbolRecord | undefined {
    return this.symbolsById.get(id);
  }

  /**
   * Get all symbols, optionally filtered.
   */
  symbolsGet(filter?: {
    file?: string;
    kind?: string;
    name?: string;
    scopeId?: ScopeId;
  }): SymbolRecord[] {
    let candidates: Iterable<SymbolId>;

    // Use most selective index
    if (filter?.name) {
      candidates = this.symbolsByName.get(filter.name) ?? [];
    } else if (filter?.file) {
      candidates = this.symbolsByFile.get(filter.file) ?? [];
    } else if (filter?.scopeId) {
      candidates = this.symbolsByScope.get(filter.scopeId) ?? [];
    } else {
      candidates = this.symbolsById.keys();
    }

    const results: SymbolRecord[] = [];
    for (const id of candidates) {
      const symbol = this.symbolsById.get(id);
      if (!symbol) continue;

      // Apply remaining filters
      if (filter?.file && symbol.file !== filter.file) continue;
      if (filter?.kind && symbol.kind !== filter.kind) continue;
      if (filter?.name && symbol.name !== filter.name) continue;
      if (filter?.scopeId && symbol.scopeId !== filter.scopeId) continue;

      results.push(symbol);
    }

    return results;
  }

  /**
   * Get a scope by ID.
   */
  scopeGet(id: ScopeId): ScopeRecord | undefined {
    return this.scopesById.get(id);
  }

  /**
   * Get all scopes in a file.
   */
  scopesInFileGet(file: string): ScopeRecord[] {
    const ids = this.scopesByFile.get(file);
    if (!ids) return [];

    const results: ScopeRecord[] = [];
    for (const id of ids) {
      const scope = this.scopesById.get(id);
      if (scope) results.push(scope);
    }
    return results;
  }

  /**
   * Get symbols defined in a scope.
   */
  symbolsInScopeGet(scopeId: ScopeId): SymbolRecord[] {
    const ids = this.symbolsByScope.get(scopeId);
    if (!ids) return [];

    const results: SymbolRecord[] = [];
    for (const id of ids) {
      const symbol = this.symbolsById.get(id);
      if (symbol) results.push(symbol);
    }
    return results;
  }

  /**
   * Get references to a symbol.
   */
  referencesGet(symbolId: SymbolId): ReferencesRelation[] {
    return this.referencesBySymbol.get(symbolId) ?? [];
  }

  /**
   * Get all references in a file.
   */
  referencesInFileGet(file: string): ReferencesRelation[] {
    return this.referencesByFile.get(file) ?? [];
  }

  /**
   * Get call relations in a scope (for finding callees).
   */
  callsInScopeGet(scopeId: ScopeId): CallsRelation[] {
    return this.callsByScope.get(scopeId) ?? [];
  }

  /**
   * Get all call relations.
   */
  callsGet(): CallsRelation[] {
    return this.relations.filter((r): r is CallsRelation => r.kind === 'Calls');
  }

  /**
   * Get imports in a file.
   */
  importsInFileGet(file: string): ImportsRelation[] {
    return this.importsByFile.get(file) ?? [];
  }

  /**
   * Get import bindings in a file.
   */
  importBindingsInFileGet(file: string): ImportBindingRelation[] {
    return this.importBindingsByFile.get(file) ?? [];
  }

  /**
   * Get the import binding for a symbol (if it was imported).
   */
  importBindingForSymbolGet(symbolId: SymbolId): ImportBindingRelation | undefined {
    return this.importBindingsBySymbol.get(symbolId);
  }

  /**
   * Get all import bindings.
   */
  importBindingsGet(): ImportBindingRelation[] {
    return this.relations.filter((r): r is ImportBindingRelation => r.kind === 'ImportBinding');
  }

  /**
   * Get exports in a file.
   */
  exportsInFileGet(file: string): ExportsRelation[] {
    return this.exportsByFile.get(file) ?? [];
  }

  /**
   * Get export by name from a specific file.
   */
  exportByNameGet(name: string, file: string): ExportsRelation | undefined {
    return this.exportsByName.get(name)?.get(file);
  }

  /**
   * Get all files that export a specific name.
   */
  exportersOfNameGet(name: string): Map<string, ExportsRelation> {
    return this.exportsByName.get(name) ?? new Map();
  }

  /**
   * Get all exports.
   */
  exportsGet(): ExportsRelation[] {
    return this.relations.filter((r): r is ExportsRelation => r.kind === 'Exports');
  }

  // ============================================================================
  // Type Relation Queries
  // ============================================================================

  /**
   * Get type relations for a symbol (what it extends/implements).
   */
  typeRelationsForSymbolGet(symbolId: SymbolId): TypeRelation[] {
    return this.typeRelationsBySymbol.get(symbolId) ?? [];
  }

  /**
   * Get type relations targeting a name (who extends/implements it).
   */
  typeRelationsByTargetNameGet(name: string): TypeRelation[] {
    return this.typeRelationsByTargetName.get(name) ?? [];
  }

  /**
   * Get all type relations in a file.
   */
  typeRelationsInFileGet(file: string): TypeRelation[] {
    return this.typeRelationsByFile.get(file) ?? [];
  }

  /**
   * Build an export map for cross-file resolution.
   * Returns: Map<filePath, Map<exportedName, SymbolId>>
   */
  exportMapBuild(): Map<string, Map<string, SymbolId>> {
    const result = new Map<string, Map<string, SymbolId>>();
    
    for (const [file, exports] of this.exportsByFile) {
      const fileExports = new Map<string, SymbolId>();
      for (const exp of exports) {
        if (exp.symbolId) {
          fileExports.set(exp.exportedName, exp.symbolId);
        }
      }
      if (fileExports.size > 0) {
        result.set(file, fileExports);
      }
    }
    
    return result;
  }

  /**
   * Update a relation (for cross-file resolution pass).
   * Finds the relation by identity and updates it.
   */
  relationUpdate<R extends RelationRecord>(
    oldRelation: R,
    newRelation: R
  ): void {
    // Update in main relations array
    const idx = this.relations.indexOf(oldRelation);
    if (idx !== -1) {
      this.relations[idx] = newRelation;
    }

    // Update indexes based on relation type
    if (oldRelation.kind === 'ImportBinding' && newRelation.kind === 'ImportBinding') {
      // Update by-symbol index
      this.importBindingsBySymbol.set(newRelation.localSymbolId, newRelation);
      
      // Update by-file index
      const symbol = this.symbolsById.get(newRelation.localSymbolId);
      if (symbol) {
        const bindings = this.importBindingsByFile.get(symbol.file);
        if (bindings) {
          const bindingIdx = bindings.indexOf(oldRelation as ImportBindingRelation);
          if (bindingIdx !== -1) {
            bindings[bindingIdx] = newRelation;
          }
        }
      }
    }

    if (oldRelation.kind === 'References' && newRelation.kind === 'References') {
      // Update reference indexes if resolvedSymbolId changed
      if (oldRelation.resolvedSymbolId !== newRelation.resolvedSymbolId) {
        // Remove from old index
        if (oldRelation.resolvedSymbolId) {
          const refs = this.referencesBySymbol.get(oldRelation.resolvedSymbolId);
          if (refs) {
            const refIdx = refs.indexOf(oldRelation);
            if (refIdx !== -1) {
              refs.splice(refIdx, 1);
            }
          }
        }
        // Add to new index
        if (newRelation.resolvedSymbolId) {
          let refs = this.referencesBySymbol.get(newRelation.resolvedSymbolId);
          if (!refs) {
            refs = [];
            this.referencesBySymbol.set(newRelation.resolvedSymbolId, refs);
          }
          refs.push(newRelation);
        }
      }

      // Update by-file index (scope determines the file)
      const scope = this.scopesById.get(oldRelation.scopeId);
      if (scope) {
        const fileRefs = this.referencesByFile.get(scope.file);
        if (fileRefs) {
          const fileRefIdx = fileRefs.indexOf(oldRelation as ReferencesRelation);
          if (fileRefIdx !== -1) {
            fileRefs[fileRefIdx] = newRelation as ReferencesRelation;
          }
        }
      }
    }

    if (oldRelation.kind === 'TypeRelation' && newRelation.kind === 'TypeRelation') {
      // Update by-symbol index
      const bySymbol = this.typeRelationsBySymbol.get(oldRelation.symbolId);
      if (bySymbol) {
        const relIdx = bySymbol.indexOf(oldRelation);
        if (relIdx !== -1) {
          bySymbol[relIdx] = newRelation;
        }
      }

      // Update by-target-name index (if targetName changed, move between buckets)
      if (oldRelation.targetName !== newRelation.targetName) {
        const oldBucket = this.typeRelationsByTargetName.get(oldRelation.targetName);
        if (oldBucket) {
          const relIdx = oldBucket.indexOf(oldRelation);
          if (relIdx !== -1) oldBucket.splice(relIdx, 1);
          if (oldBucket.length === 0) this.typeRelationsByTargetName.delete(oldRelation.targetName);
        }
        let newBucket = this.typeRelationsByTargetName.get(newRelation.targetName);
        if (!newBucket) {
          newBucket = [];
          this.typeRelationsByTargetName.set(newRelation.targetName, newBucket);
        }
        newBucket.push(newRelation);
      } else {
        const bucket = this.typeRelationsByTargetName.get(oldRelation.targetName);
        if (bucket) {
          const relIdx = bucket.indexOf(oldRelation);
          if (relIdx !== -1) {
            bucket[relIdx] = newRelation;
          }
        }
      }

      // Update by-file index
      const childSym = this.symbolsById.get(oldRelation.symbolId);
      if (childSym) {
        const fileRels = this.typeRelationsByFile.get(childSym.file);
        if (fileRels) {
          const relIdx = fileRels.indexOf(oldRelation as TypeRelation);
          if (relIdx !== -1) {
            fileRels[relIdx] = newRelation as TypeRelation;
          }
        }
      }
    }

    if (oldRelation.kind === 'Imports' && newRelation.kind === 'Imports') {
      // Update by-file index (file derived from scope)
      const scope = this.scopesById.get(oldRelation.scopeId);
      if (scope) {
        const fileImports = this.importsByFile.get(scope.file);
        if (fileImports) {
          const impIdx = fileImports.indexOf(oldRelation as ImportsRelation);
          if (impIdx !== -1) {
            fileImports[impIdx] = newRelation as ImportsRelation;
          }
        }
      }
    }
  }

  /**
   * Get all relations of a specific kind.
   */
  relationsGet<K extends RelationRecord['kind']>(
    kind: K
  ): Extract<RelationRecord, { kind: K }>[] {
    return this.relations.filter(
      (r): r is Extract<RelationRecord, { kind: K }> => r.kind === kind
    );
  }

  /**
   * Check if a file has been indexed with a specific revision.
   */
  fileHasRevision(file: string, revision: string): boolean {
    return this.fileRevisions.get(file) === revision;
  }

  /**
   * Get the current revision for a file.
   */
  fileRevisionGet(file: string): string | undefined {
    return this.fileRevisions.get(file);
  }

  /**
   * Get all indexed files.
   */
  filesGet(): string[] {
    return Array.from(this.fileRevisions.keys());
  }

  // ============================================================================
  // Control Flow Graph Queries
  // ============================================================================

  /**
   * Get the control flow graph for a specific scope.
   */
  cfgGet(scopeId: string): FlowGraph | undefined {
    return this.cfgByScope.get(scopeId);
  }

  /**
   * Get all control flow graphs in a file.
   */
  cfgsInFileGet(file: string): FlowGraph[] {
    return this.cfgsByFile.get(file) ?? [];
  }

  /**
   * Get statistics about the index.
   */
  statsGet(): {
    files: number;
    symbols: number;
    scopes: number;
    relations: number;
  } {
    return {
      files: this.fileRevisions.size,
      symbols: this.symbolsById.size,
      scopes: this.scopesById.size,
      relations: this.relations.length,
    };
  }
}

/**
 * Create a new IndexStore instance.
 */
export function indexStoreNew(): IndexStore {
  return new IndexStore();
}

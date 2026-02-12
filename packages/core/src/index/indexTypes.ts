/**
 * @packageDocumentation
 * Core semantic index primitives for cross-file analysis.
 *
 * These types are language-agnostic and form the stable public API
 * that plugins use to query project-wide information.
 *
 * Design principles:
 * - No AST nodes or compiler internals exposed
 * - All IDs are stable across re-indexing if content unchanged
 * - Relations are append-only facts
 * - Query API is total (no nulls, no panics)
 */

// ============================================================================
// Stable IDs
// ============================================================================

/** Stable identifier for a symbol (declaration) */
export type SymbolId = string;

/** Stable identifier for a scope */
export type ScopeId = string;

// ============================================================================
// Enums / Kinds
// ============================================================================

/**
 * Language-agnostic symbol kinds.
 * Adapters map language-specific node types to these canonical kinds.
 */
export type SymbolKind =
  | 'module'
  | 'namespace'
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'method'
  | 'variable'
  | 'const'
  | 'field'
  | 'parameter'
  | 'enum'
  | 'enumMember';

/**
 * Language-agnostic scope kinds.
 * Scopes form a tree structure for name resolution and visibility.
 */
export type ScopeKind =
  | 'file'
  | 'module'
  | 'type'
  | 'function'
  | 'block'
  | 'class'
  | 'namespace';

// ============================================================================
// Symbol Flags (bitset)
// ============================================================================

/**
 * Symbol attribute flags as a bitset.
 * Combine with bitwise OR: `SymbolFlags.Exported | SymbolFlags.Async`
 */
export const SymbolFlags = {
  None: 0,
  Exported: 1 << 0,
  Async: 1 << 1,
  Generator: 1 << 2,
  Static: 1 << 3,
  Abstract: 1 << 4,
  Readonly: 1 << 5,
  Optional: 1 << 6,
  Private: 1 << 7,
  Protected: 1 << 8,
  Public: 1 << 9,
} as const;

export type SymbolFlagsType = (typeof SymbolFlags)[keyof typeof SymbolFlags];

// ============================================================================
// Core Records
// ============================================================================

/**
 * Byte range within a file.
 * Uses byte offsets (not line/column) for precision and performance.
 */
export type ByteRange = {
  /** Start byte offset (inclusive) */
  start: number;
  /** End byte offset (exclusive) */
  end: number;
};

/**
 * A symbol (declaration) in the semantic index.
 * Symbols are uniquely identified by their `id` which is stable across re-indexing.
 */
export type SymbolRecord = {
  /** Stable unique identifier */
  id: SymbolId;
  /** Language-agnostic kind */
  kind: SymbolKind;
  /** Declared name (local, not qualified) */
  name: string;
  /** Absolute file path */
  file: string;
  /** Byte range of the declaration */
  range: ByteRange;
  /** Scope that contains this symbol */
  scopeId: ScopeId;
  /** Qualified name for disambiguation (scope-based) */
  qualName: string;
  /** Attribute flags (exported, async, etc.) */
  flags: number;
};

/**
 * A scope (lexical/semantic boundary) in the semantic index.
 * Scopes form a tree via the `parent` field.
 */
export type ScopeRecord = {
  /** Stable unique identifier */
  id: ScopeId;
  /** Scope kind */
  kind: ScopeKind;
  /** Absolute file path */
  file: string;
  /** Byte range of the scope */
  range: ByteRange;
  /** Parent scope ID (undefined for file scope) */
  parent?: ScopeId;
};

// ============================================================================
// Relations (append-only facts)
// ============================================================================

/**
 * A "Defines" relation: a scope declares a symbol.
 */
export type DefinesRelation = {
  kind: 'Defines';
  scopeId: ScopeId;
  symbolId: SymbolId;
};

/**
 * A "Contains" relation: a scope contains a child scope.
 */
export type ContainsRelation = {
  kind: 'Contains';
  scopeId: ScopeId;
  childScopeId: ScopeId;
};

/**
 * A "References" relation: an identifier refers to a symbol.
 * `resolvedSymbolId` is undefined if resolution failed (cross-file or unknown).
 */
export type ReferencesRelation = {
  kind: 'References';
  scopeId: ScopeId;
  name: string;
  range: ByteRange;
  /** Resolved symbol ID (file-local resolution only) */
  resolvedSymbolId?: SymbolId;
};

/**
 * An "Imports" relation: a scope imports from a module specifier.
 */
export type ImportsRelation = {
  kind: 'Imports';
  scopeId: ScopeId;
  /** Module specifier (e.g., './foo', 'lodash') */
  spec: string;
  range: ByteRange;
};

/**
 * A "Calls" relation: a call expression within a scope.
 * `resolvedSymbolId` is undefined if resolution failed.
 */
export type CallsRelation = {
  kind: 'Calls';
  scopeId: ScopeId;
  /** Callee name (may include dots for member calls) */
  calleeName: string;
  range: ByteRange;
  /** Resolved symbol ID (file-local resolution only) */
  resolvedSymbolId?: SymbolId;
};

/**
 * An "ImportBinding" relation: links an imported name to its source module.
 * Used for cross-file symbol resolution.
 */
export type ImportBindingRelation = {
  kind: 'ImportBinding';
  /** The symbol created by this import (the local binding) */
  localSymbolId: SymbolId;
  /** Original exported name (may differ from local if aliased) */
  importedName: string;
  /** Module specifier (e.g., './utils', 'lodash') */
  moduleSpec: string;
  /** Absolute file path of the source module (populated in resolution pass) */
  resolvedModulePath?: string;
  /** Resolved symbol ID from the source module (populated in resolution pass) */
  resolvedExportId?: SymbolId;
  /** Whether this is a default import */
  isDefault: boolean;
  /** Whether this is a namespace import (import * as X) */
  isNamespace: boolean;
  /** Byte range of the import statement */
  range: ByteRange;
};

/**
 * An "Exports" relation: marks a symbol as exported from its module.
 * Used for cross-file symbol resolution.
 */
export type ExportsRelation = {
  kind: 'Exports';
  /** The symbol being exported */
  symbolId: SymbolId;
  /** Exported name (may differ from symbol.name if aliased) */
  exportedName: string;
  /** Whether this is the default export */
  isDefault: boolean;
  /** For re-exports: source module specifier */
  sourceModule?: string;
  /** For re-exports: original name in source module */
  sourceName?: string;
  /** Byte range of the export statement */
  range: ByteRange;
};

/**
 * Union of all relation types.
 * Relations are append-only facts extracted by adapters.
 */
export type RelationRecord =
  | DefinesRelation
  | ContainsRelation
  | ReferencesRelation
  | ImportsRelation
  | CallsRelation
  | ImportBindingRelation
  | ExportsRelation;

// ============================================================================
// Query Filter Types
// ============================================================================

/**
 * Filter options for symbol queries.
 */
export type SymbolFilter = {
  /** Filter by file path */
  file?: string;
  /** Filter by symbol kind */
  kind?: SymbolKind;
  /** Filter by symbol name (exact match) */
  name?: string;
  /** Filter by scope */
  scopeId?: ScopeId;
};

// ============================================================================
// Index Capabilities
// ============================================================================

/**
 * Declares what capabilities the index supports.
 * Plugins can check this before attempting queries.
 */
export type IndexCapabilities = {
  /** Whether cross-file symbol resolution is available */
  crossFileResolution: boolean;
  /** Call graph accuracy level */
  callGraph: 'none' | 'heuristic' | 'precise';
  /** Languages that have been indexed */
  supportedLanguages: string[];
};

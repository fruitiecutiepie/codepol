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

type SymbolFlagsType = (typeof SymbolFlags)[keyof typeof SymbolFlags];

/**
 * Binding-kind metadata for local declarations.
 * Used by higher-level rules such as native `no-unused-vars`.
 */
export type SymbolBindingKind =
  | 'catch'
  | 'function-expression-name'
  | 'import'
  | 'parameter';

/**
 * Binding-pattern metadata for destructuring-aware rules.
 */
export type SymbolPatternKind =
  | 'array'
  | 'identifier'
  | 'object';

/**
 * Optional metadata for local bindings.
 */
export type SymbolBindingInfo = {
  /** Special binding category (catch, parameter, import, etc.) */
  bindingKind?: SymbolBindingKind;
  /** Pattern shape that introduced the binding */
  pattern?: SymbolPatternKind;
  /** Whether the binding is a rest element */
  isRest?: boolean;
  /** Whether the binding has a sibling object rest element */
  hasRestSibling?: boolean;
  /** Whether the binding receives an initial value from its declaration/default */
  initialized?: boolean;
  /** Whether the binding is visible throughout its containing scope */
  hoisted?: boolean;
  /** Parameter position for `args: "after-used"` semantics */
  parameterIndex?: number;
};

/**
 * Reference usage flags.
 * Multiple flags may be combined with bitwise OR.
 */
export const ReferenceUsage = {
  None: 0,
  Read: 1 << 0,
  Write: 1 << 1,
  Type: 1 << 2,
  SelfUpdate: 1 << 3,
} as const;

export type ReferenceUsageType =
  (typeof ReferenceUsage)[keyof typeof ReferenceUsage];

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
  byteRange: ByteRange;
  /** Scope that contains this symbol */
  scopeId: ScopeId;
  /** Qualified name for disambiguation (scope-based) */
  qualName: string;
  /** Attribute flags (exported, async, etc.) */
  flags: number;
  /** Optional binding metadata for local-variable style rules */
  binding?: SymbolBindingInfo;
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
  byteRange: ByteRange;
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
  byteRange: ByteRange;
  /** Resolved symbol ID (file-local resolution only) */
  resolvedSymbolId?: SymbolId;
  /**
   * Original file-local resolved symbol ID before any cross-file rewrite.
   * Preserved so rules can still reason about local import bindings after
   * `resolvedSymbolId` is rewritten to the exported target symbol.
   */
  localSymbolId?: SymbolId;
  /** Usage facts for the reference (read/write/type/self-update) */
  usage?: ReferenceUsageType;
};

/**
 * An "Imports" relation: a scope imports from a module specifier.
 */
export type ImportsRelation = {
  kind: 'Imports';
  scopeId: ScopeId;
  /** Module specifier (e.g., './foo', 'lodash') */
  spec: string;
  byteRange: ByteRange;
  /** Resolved absolute path (set during cross-file resolution) */
  resolvedModulePath?: string;
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
  byteRange: ByteRange;
  /** Resolved symbol ID (file-local resolution only) */
  resolvedSymbolId?: SymbolId;
};

/**
 * Syntactic style of an import as captured at extraction time.
 *
 * - `static`: ES module static import (`import`/`from`) or language-native
 *   static module import (Python `import`/`from`).
 * - `dynamic`: ES dynamic import (`import(spec)` or `await import(spec)`),
 *   including destructured and whole-module bindings.
 * - `cjs`: CommonJS `require()` call binding.
 *
 * The value is advisory metadata for consumers that want to distinguish
 * edge kinds; omitted values default to `static` for back-compat.
 */
export type ImportStyle = 'static' | 'dynamic' | 'cjs';

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
  /** Source range of the imported name token when present (e.g. `foo` in `import { foo as bar }`) */
  importedNameByteRange?: ByteRange;
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
  byteRange: ByteRange;
  /**
   * Syntactic style of the import (static/dynamic/cjs). Optional for
   * backwards compatibility; absent values should be treated as `static`.
   */
  importStyle?: ImportStyle;
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
  byteRange: ByteRange;
};

/**
 * A "TypeRelation" relation: captures type hierarchy edges.
 * Records extends/implements relationships between classes and interfaces.
 * `resolvedTargetId` is populated during file-local resolution in
 * `typeRelationsExtract`, then updated to the actual exported symbol
 * during cross-file resolution (Step 6 in `crossFileResolve`).
 */
export type TypeRelation = {
  kind: 'TypeRelation';
  /** The child symbol (class or interface that extends/implements) */
  symbolId: SymbolId;
  /** Parent/interface name as raw text from source */
  targetName: string;
  /** Whether this is an extends or implements relationship */
  relationKind: 'extends' | 'implements';
  /** Byte range of the extends/implements clause */
  byteRange: ByteRange;
  /** Resolved target symbol ID (populated during resolution) */
  resolvedTargetId?: SymbolId;
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
  | ExportsRelation
  | TypeRelation;

// ============================================================================
// Control Flow Graph
// ============================================================================

/** Stable identifier for a flow graph node */
export type FlowNodeId = string;

/**
 * Language-agnostic control flow node kinds.
 * These represent the structural elements of a function's control flow.
 */
export type FlowNodeKind =
  | 'entry'     // Function entry point (exactly one per CFG)
  | 'exit'      // Function exit point (exactly one per CFG)
  | 'statement'  // Basic statement (sequential flow)
  | 'branch'    // Decision point (if condition, loop condition)
  | 'merge'     // Where branches rejoin (after if/else, after loop)
  | 'loop'      // Loop header (back-edge target)
  | 'return'    // Return statement
  | 'throw';    // Throw statement

/**
 * A node in a control flow graph.
 * Nodes represent control flow points within a function body.
 */
export type FlowNode = {
  /** Stable identifier */
  id: FlowNodeId;
  /** Node kind */
  kind: FlowNodeKind;
  /** Byte range of the corresponding source (undefined for synthetic entry/exit) */
  byteRange?: ByteRange;
  /** Human-readable label for debugging/display */
  label?: string;
};

/**
 * An edge in a control flow graph.
 * Edges represent possible transitions between control flow points.
 */
export type FlowEdge = {
  /** Source node */
  from: FlowNodeId;
  /** Target node */
  to: FlowNodeId;
  /** Edge label describing the transition condition */
  label?: 'true' | 'false' | 'loop-back' | 'unconditional' | 'break' | 'continue' | 'case' | 'default' | 'exception' | 'finally';
};

/**
 * A control flow graph for a single function/method scope.
 * Contains exactly one entry node and one exit node.
 * Built during adapter extraction, stored per function scope.
 */
export type FlowGraph = {
  /** The scope this CFG belongs to (a function/method scope) */
  scopeId: ScopeId;
  /** All nodes in the graph */
  nodes: FlowNode[];
  /** All edges in the graph */
  edges: FlowEdge[];
};

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
  /** Whether control flow graphs are available */
  controlFlowGraph: boolean;
  /** Languages that have been indexed */
  supportedLanguages: string[];
};

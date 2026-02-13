/**
 * @packageDocumentation
 * Types for Tree-sitter index adapters.
 *
 * These types define the contract between the adapter core and
 * language-specific configurations.
 */

import type { Language } from 'web-tree-sitter';
import type {
  SymbolKind,
  ScopeKind,
  SymbolRecord,
  ScopeRecord,
  RelationRecord,
  ByteRange,
} from '../../index/indexTypes';

// ============================================================================
// Adapter Diagnostics
// ============================================================================

/**
 * Diagnostic message from the adapter.
 * Used to report gaps or issues during indexing.
 */
export type AdapterDiagnostic = {
  severity: 'info' | 'warn' | 'error';
  message: string;
  range?: { start: number; end: number };
};

// ============================================================================
// File Index Delta
// ============================================================================

/**
 * Result of indexing a single file.
 * Produced by language adapters, consumed by IndexStore.
 */
export type FileIndexDelta = {
  /** Absolute file path */
  file: string;
  /** Revision identifier (e.g., content hash) */
  revision: string;
  /** Symbols declared in this file */
  symbols: SymbolRecord[];
  /** Scopes in this file */
  scopes: ScopeRecord[];
  /** Relations extracted from this file */
  relations: RelationRecord[];
  /** Diagnostic messages from the adapter */
  diagnostics: AdapterDiagnostic[];
};

// ============================================================================
// Query Pack
// ============================================================================

/**
 * Collection of Tree-sitter query files for a language.
 * Each query file contains S-expression patterns for capturing
 * specific syntactic constructs.
 */
export type QueryPack = {
  /** Scope boundary patterns */
  scopes: string;
  /** Symbol declaration patterns */
  symbols: string;
  /** Reference/identifier patterns */
  refs: string;
  /** Call expression patterns (optional) */
  calls?: string;
  /** Import patterns (optional) */
  imports?: string;
  /** Export patterns for cross-file resolution (optional) */
  exports?: string;
  /** Type relation patterns (extends/implements) (optional) */
  typeRelations?: string;
};

// ============================================================================
// Capture Names
// ============================================================================

/**
 * Standard capture name conventions used in query patterns.
 * Adapters use these to interpret query results consistently.
 */
export type CaptureNames = {
  /** Capture name for scope nodes (default: "scope") */
  scopeNode: string;
  /** Capture name for symbol name nodes (default: "name") */
  symbolName: string;
  /** Capture name prefix for symbol kind (default: "decl") */
  symbolKindPrefix: string;
  /** Capture name prefix for references (default: "ref") */
  refPrefix: string;
  /** Capture name prefix for call callees (default: "callee") */
  calleePrefix: string;
  /** Capture name for import sources (default: "import") */
  importPrefix: string;
};

/**
 * Default capture names.
 */
export const CAPTURE_NAMES_DEFAULT: CaptureNames = {
  scopeNode: 'scope',
  symbolName: 'name',
  symbolKindPrefix: 'decl',
  refPrefix: 'ref',
  calleePrefix: 'callee',
  importPrefix: 'import',
};

// ============================================================================
// Kind Mappings
// ============================================================================

/**
 * Maps Tree-sitter node types to semantic SymbolKind.
 * Each language adapter provides its own mapping.
 */
export type SymbolKindMapping = {
  /** Map from capture suffix to SymbolKind (e.g., "class" -> "class") */
  byCaptureSuffix: Record<string, SymbolKind>;
  /** Map from node type to SymbolKind as fallback */
  byNodeType?: Record<string, SymbolKind>;
  /** Default kind if no match found */
  default: SymbolKind;
};

/**
 * Maps Tree-sitter node types to semantic ScopeKind.
 */
export type ScopeKindMapping = {
  /** Map from node type to ScopeKind */
  byNodeType: Record<string, ScopeKind>;
  /** Default kind if no match found */
  default: ScopeKind;
};

// ============================================================================
// Language Configuration
// ============================================================================

/**
 * Configuration for a language adapter.
 * Defines how to extract semantic information from Tree-sitter parse results.
 */
export type LangConfig = {
  /** Language identifier (e.g., "typescript", "python") */
  languageId: string;
  /** Tree-sitter Language object */
  language: Language;
  /** Query patterns for this language */
  queries: QueryPack;
  /** Capture name conventions */
  captures: CaptureNames;
  /** Symbol kind mapping */
  symbolKinds: SymbolKindMapping;
  /** Scope kind mapping */
  scopeKinds: ScopeKindMapping;
  /**
   * Post-filter for references.
   * Returns true if the reference should be kept.
   * Used to filter out declaration sites, property keys, etc.
   */
  refFilter?: (node: RefFilterContext) => boolean;
};

/**
 * Context passed to reference filter function.
 */
export type RefFilterContext = {
  /** The identifier text */
  name: string;
  /** Node type of the identifier */
  nodeType: string;
  /** Parent node type */
  parentType: string;
  /** Grandparent node type */
  grandparentType?: string;
  /** Byte range of the identifier */
  byteRange: ByteRange;
  /** Set of declaration ranges in the file (for filtering out decl sites) */
  declarationRanges: Set<string>;
};

// ============================================================================
// Adapter Capabilities
// ============================================================================

/**
 * Declares what the adapter can reliably extract.
 * Used to set expectations for consumers.
 */
export type AdapterCapabilities = {
  /** Whether cross-file resolution is supported */
  crossFileResolution: boolean;
  /** Call graph accuracy */
  callGraph: 'none' | 'heuristic';
  /** Symbol kinds that can be extracted */
  symbolKinds: Set<SymbolKind>;
  /** Known limitations (human-readable) */
  limitations: string[];
};

// ============================================================================
// Index Adapter Interface
// ============================================================================

/**
 * Interface for language-specific index adapters.
 */
export type IndexAdapter = {
  /** Language identifier */
  languageId: string;
  /** Adapter capabilities */
  capabilities: AdapterCapabilities;
  /**
   * Index a file and return the delta.
   * @param file - Absolute file path
   * @param bytes - File contents as bytes
   * @param revision - Revision identifier
   */
  indexFile(file: string, bytes: Uint8Array, revision: string): FileIndexDelta;
};

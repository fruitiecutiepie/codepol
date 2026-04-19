/**
 * @packageDocumentation
 * Semantic index module re-exports.
 *
 * This module provides the public API for cross-file analysis:
 * - Core types (Symbol, Scope, Relation)
 * - Query interface (ProjectIndex)
 * - Index builder
 */

// Core types
export type {
  SymbolId,
  ScopeId,
  SymbolKind,
  ScopeKind,
  ByteRange,
  SymbolRecord,
  ScopeRecord,
  RelationRecord,
  DefinesRelation,
  ContainsRelation,
  ReferencesRelation,
  ImportsRelation,
  CallsRelation,
  TypeRelation,
  SymbolFlowKind,
  SymbolFlowRelation,
  SymbolFilter,
  IndexCapabilities,
  FlowNodeId,
  FlowNode,
  FlowEdge,
  FlowGraph,
  FlowNodeKind,
} from './indexTypes';

export { SymbolFlags } from './indexTypes';

// Store (primarily internal, but exposed for advanced use)
export type { FileIndexDelta } from './indexStore';
export { IndexStore, indexStoreNew } from './indexStore';

// Query API
export type { ProjectIndex } from './indexQuery';
export { projectIndexCreate } from './indexQuery';

// Builder
export type { IndexBuildOptions, IndexBuildResult } from './indexBuilder';
export {
  projectIndexBuild,
  projectIndexUpdate,
  projectIndexRemoveFiles,
  adapterRegister,
} from './indexBuilder';

// Type-aware call-graph source (Phase 9.2 / Gap 1)
export type {
  TypeAwareCallEdge,
  TypeAwareCallKind,
  TypeAwareCallGraphSource,
} from './typeAwareCallGraphSource';
export type { TypeAwareCallGraphSourceRegistry } from './typeAwareCallGraphSourceRegistry';
export { typeAwareCallGraphSourceRegistryCreate } from './typeAwareCallGraphSourceRegistry';

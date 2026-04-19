/**
 * @packageDocumentation
 * Per-language source of type-aware call-graph answers.
 *
 * Phase 9.2 / Gap 1. Mirrors `TypeAwareTypeHierarchySource` (Phase 9.5)
 * one-for-one but stays a *separate* interface — the two have nothing
 * in common beyond a similar shape, and merging them would couple
 * two unrelated language-server features.
 *
 * Implementations live in language-specific packages (e.g.
 * `packages/typescript-language-bridge`) and never in core. Core only
 * consumes this interface; it has no idea what `tsserver`, `pyright`,
 * or any other backing language server is.
 *
 * When no source is registered for a language, the workspace falls
 * back to the structural call graph derived from the tree-sitter
 * index. That fallback is byte-identical to today's behavior — the
 * type-aware path is purely additive.
 */

import type { SymbolId } from './indexTypes';

/**
 * Kind of call expressed by an edge from a `TypeAwareCallGraphSource`.
 *
 * - `'direct'`: a named callee resolved at the call site.
 * - `'dynamic-dispatch'`: a method call whose receiver type admits
 *   multiple implementations (interface- or union-typed receiver).
 * - `'higher-order'`: a call site whose callee is an argument or
 *   computed value rather than a named symbol.
 *
 * When the language server cannot distinguish, sources should default
 * to `'direct'` — the honest choice is to not invent precision the
 * source did not actually provide.
 */
export type TypeAwareCallKind = 'direct' | 'dynamic-dispatch' | 'higher-order';

/**
 * One type-aware call-graph edge. Consumed by the workspace service's
 * conflict-resolution merge in `workspaceCallGraphResultCreate`.
 */
export type TypeAwareCallEdge = {
  callerSymbolId: SymbolId;
  calleeSymbolId: SymbolId;
  callKind: TypeAwareCallKind;
};

/**
 * Type-aware call-graph source for one language. Both methods are
 * optional — a source that only knows callers (or only callees) may
 * implement just one, and the workspace will treat the missing
 * direction as "no type-aware data" and fall back to structural for
 * that direction only.
 *
 * Implementations must be cancellable via the host's transport so the
 * workspace's existing `signal`-based cancellation propagates. The
 * workspace applies a configurable timeout (default 2000 ms) on top
 * of the source's own cancellation; on timeout the merge degrades to
 * structural-only.
 */
export type TypeAwareCallGraphSource = {
  typeAwareCallersGet?(symbolId: SymbolId): Promise<TypeAwareCallEdge[]>;
  typeAwareCalleesGet?(symbolId: SymbolId): Promise<TypeAwareCallEdge[]>;
};

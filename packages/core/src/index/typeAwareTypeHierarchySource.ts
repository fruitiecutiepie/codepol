/**
 * @packageDocumentation
 * Per-language source of type-aware type-hierarchy answers.
 *
 * Phase 9.5 / Gap 3. Mirrors `TypeAwareCallGraphSource` (Phase 9.2)
 * one-for-one but stays a *separate* interface — the two have
 * nothing in common beyond a similar shape, and merging them would
 * couple two unrelated language-server features.
 *
 * Implementations live in language-specific packages (e.g.
 * `packages/typescript-language-bridge`) and never in core. Core
 * only consumes this interface; it has no idea what `tsserver`,
 * `pyright`, or any other backing language server is.
 *
 * When no source is registered for a language, the workspace falls
 * back to the structural answer (declared edges + opt-in shape match).
 * That fallback is byte-identical to today's behavior — the
 * type-aware path is purely additive.
 */

import type { SymbolId } from './indexTypes';

/**
 * One type-aware type-hierarchy edge. Consumed by the workspace
 * service's conflict-resolution merge in
 * `workspaceTypeHierarchyResultCreate`.
 *
 * The edge is always oriented `subtype → supertype`, mirroring the
 * structural `TypeRelation` model where the child symbol appears in
 * `symbolId` and the parent in `resolvedTargetId`.
 */
export type TypeAwareTypeHierarchyEdge = {
  /** Subtype side (child / implementer). */
  subtypeSymbolId: SymbolId;
  /** Supertype side (parent / interface). */
  supertypeSymbolId: SymbolId;
  /** How the source identified the relation. */
  relationKind: 'extends' | 'implements';
};

/**
 * Per-language source of type-aware type-hierarchy answers. Both
 * methods are optional — a source that only knows implementers (or
 * only supertypes) may implement just one, and the workspace will
 * treat the missing direction as "no type-aware data" and fall back
 * to the structural answer for that direction only.
 *
 * Implementations must be cancellable via the host's transport so
 * the workspace's existing `signal`-based cancellation propagates.
 * The workspace applies a configurable timeout (default 2000 ms) on
 * top of the source's own cancellation; on timeout the merge degrades
 * to the structural-only answer and logs once at debug level.
 */
export type TypeAwareTypeHierarchySource = {
  /**
   * Return every implementer / subtype of {@link supertypeSymbolId}
   * the source can confirm. Edges are merged with the structural
   * answer by `(subtypeSymbolId, supertypeSymbolId)`.
   */
  typeAwareImplementersGet?(
    supertypeSymbolId: SymbolId,
  ): Promise<TypeAwareTypeHierarchyEdge[]>;
  /**
   * Return every supertype of {@link subtypeSymbolId} the source can
   * confirm. Edges are merged with the structural answer by
   * `(subtypeSymbolId, supertypeSymbolId)`.
   */
  typeAwareSupertypesGet?(
    subtypeSymbolId: SymbolId,
  ): Promise<TypeAwareTypeHierarchyEdge[]>;
};

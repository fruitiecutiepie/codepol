/**
 * @packageDocumentation
 * Per-language registry of {@link TypeAwareTypeHierarchySource}s.
 *
 * Phase 9.5 / Gap 3. One job: hold the language-id ↔ source mapping
 * the workspace consults from `workspaceTypeHierarchyResultCreate`.
 * There is no module-level singleton — the registry is constructed
 * once per `WorkspaceServiceEngine` and passed in. Independent of
 * `TypeAwareCallGraphSourceRegistry`; registering one source does
 * not require or affect the other.
 *
 * Last-write-wins on duplicate registrations: the most recent
 * `typeAwareTypeHierarchySourceRegister` for a given `languageId`
 * overwrites any prior entry. Hosts that need failover should layer
 * a composite source on top instead of relying on registry ordering.
 */

import type { TypeAwareTypeHierarchySource } from './typeAwareTypeHierarchySource';

export type TypeAwareTypeHierarchySourceRegistry = {
  /**
   * Register (or overwrite) the type-aware type-hierarchy source for
   * `languageId`. Re-registering with `undefined` is not supported —
   * callers should drop the registry and create a new one if they
   * need to "unregister".
   */
  typeAwareTypeHierarchySourceRegister(
    languageId: string,
    source: TypeAwareTypeHierarchySource,
  ): void;
  /**
   * Look up the source for `languageId`. Returns `undefined` when no
   * source has been registered for the language. The workspace
   * interprets `undefined` as "no type-aware data available; fall
   * back to the structural answer".
   */
  typeAwareTypeHierarchySourceGet(
    languageId: string,
  ): TypeAwareTypeHierarchySource | undefined;
};

export function typeAwareTypeHierarchySourceRegistryCreate(): TypeAwareTypeHierarchySourceRegistry {
  const sources = new Map<string, TypeAwareTypeHierarchySource>();

  return {
    typeAwareTypeHierarchySourceRegister(languageId, source) {
      sources.set(languageId, source);
    },
    typeAwareTypeHierarchySourceGet(languageId) {
      return sources.get(languageId);
    },
  };
}

/**
 * @packageDocumentation
 * Per-language registry of {@link TypeAwareCallGraphSource}s.
 *
 * Phase 9.2 / Gap 1. One job: hold the language-id ↔ source mapping
 * the workspace consults from `workspaceCallGraphResultCreate`. There
 * is no module-level singleton — the registry is constructed once per
 * `WorkspaceServiceEngine` and passed in. Independent of
 * `TypeAwareTypeHierarchySourceRegistry`; registering one source does
 * not require or affect the other.
 *
 * Last-write-wins on duplicate registrations: the most recent
 * `typeAwareCallGraphSourceRegister` for a given `languageId`
 * overwrites any prior entry. Hosts that need failover should layer a
 * composite source on top instead of relying on registry ordering.
 */

import type { TypeAwareCallGraphSource } from './typeAwareCallGraphSource';

export type TypeAwareCallGraphSourceRegistry = {
  /**
   * Register (or overwrite) the type-aware call-graph source for
   * `languageId`. Re-registering with `undefined` is not supported —
   * callers should drop the registry and create a new one if they
   * need to "unregister".
   */
  typeAwareCallGraphSourceRegister(
    languageId: string,
    source: TypeAwareCallGraphSource,
  ): void;
  /**
   * Look up the source for `languageId`. Returns `undefined` when no
   * source has been registered for the language. The workspace
   * interprets `undefined` as "no type-aware data available; fall back
   * to the structural-only result".
   */
  typeAwareCallGraphSourceGet(
    languageId: string,
  ): TypeAwareCallGraphSource | undefined;
};

export function typeAwareCallGraphSourceRegistryCreate(): TypeAwareCallGraphSourceRegistry {
  const sources = new Map<string, TypeAwareCallGraphSource>();

  return {
    typeAwareCallGraphSourceRegister(languageId, source) {
      sources.set(languageId, source);
    },
    typeAwareCallGraphSourceGet(languageId) {
      return sources.get(languageId);
    },
  };
}

/**
 * @packageDocumentation
 * Per-symbol importer enumeration over a {@link ProjectIndex}.
 *
 * Phase 5 follow-up. Answers "how many distinct files import THIS
 * exported symbol?" — the per-symbol counterpart to the existing
 * {@link ModuleGraph.moduleGraphImportersGet}, which only returns the
 * file-level importer set.
 *
 * The helper is pure: it never mutates the index, never reaches into
 * `IndexStore` directly, and emits deterministic output (lex-sorted file
 * paths). The input symbol id is normalized through
 * {@link ProjectIndex.symbolCanonicalIdGet} so callers can pass either
 * the canonical declaration id or a local re-export proxy id and get
 * the same answer.
 *
 * Implementation walks every file's
 * {@link ProjectIndex.importBindingsGet} once and collects files whose
 * binding `resolvedExportId` matches the canonical id. The
 * `resolvedExportId` is already collapsed to the origin declaration by
 * `crossFileResolve`'s Step 5b (`exportMapAddReexportedSymbols`), so
 * this helper does not need to re-walk re-export chains.
 */
import type { ProjectIndex } from './indexQuery';
import type { SymbolId } from './indexTypes';

export type SymbolImportersInput = {
  /** Canonical or proxy symbol id to find importers for. */
  symbolId: SymbolId;
};

export type SymbolImportersResult = {
  /**
   * The canonical declaration id corresponding to the input
   * `symbolId`. Identical to the input when the input was already
   * canonical or when the index has no resolution data for it.
   */
  symbolId: SymbolId;
  /**
   * Distinct importer file paths, sorted lexicographically. The set
   * does NOT include the file that declares the symbol (an
   * `ImportBinding` only exists in importers).
   */
  importerFilePaths: string[];
};

/**
 * Enumerate the distinct files whose `ImportBinding` resolves
 * (transitively, via `resolvedExportId`) to the given symbol.
 *
 * Returns `{ symbolId: <canonical>, importerFilePaths: [] }` when no
 * file imports the symbol. The traversal complexity is
 * `O(sum(importBindings per file))` — a single linear pass; we do not
 * build a reverse index because the result is requested per-symbol
 * lazily and the workspace service rebuilds the index on every store
 * mutation, which would invalidate any cache.
 */
export function symbolImportersCompute(
  index: ProjectIndex,
  input: SymbolImportersInput,
): SymbolImportersResult {
  const canonicalSymbolId = index.symbolCanonicalIdGet(input.symbolId);
  const importerFiles = new Set<string>();
  for (const file of index.filesGet()) {
    const bindings = index.importBindingsGet(file);
    for (const binding of bindings) {
      if (binding.resolvedExportId === undefined) continue;
      // Resolve through the canonical chain so a binding that points at
      // a re-export proxy still matches the canonical declaration.
      const resolvedCanonical = index.symbolCanonicalIdGet(binding.resolvedExportId);
      if (resolvedCanonical === canonicalSymbolId) {
        importerFiles.add(file);
        break;
      }
    }
  }
  return {
    symbolId: canonicalSymbolId,
    importerFilePaths: [...importerFiles].sort(),
  };
}

/**
 * @packageDocumentation
 * Dependency-graph LOC counting.
 *
 * Counts newline-terminated lines in a file's source so the workspace
 * dependency graph can surface per-node weight ("LOC") on the panel.
 *
 * Lives in its own module so the catch-on-read branch is unit-testable
 * without setting up a full workspace fixture. Production code injects
 * the source reader via the `sourceGet` thunk; the helper itself owns
 * only the line counting and error swallowing.
 */

/**
 * Count the number of lines in a source string.
 *
 * Treats `'\n'` as a line terminator and counts a trailing partial
 * line (no terminating newline) as one additional line. An empty
 * string returns 0.
 *
 * The function is intentionally synchronous, side-effect-free, and
 * unaware of where the source came from (overlay, disk, in-memory
 * fixture) so the caller decides how to read.
 */
export function dependencyGraphLineCountFromSource(source: string): number {
  if (source.length === 0) {
    return 0;
  }
  let count = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  if (source.charCodeAt(source.length - 1) !== 10) {
    count += 1;
  }
  return count;
}

/**
 * Count the lines of the source returned by `sourceGet`. Returns
 * `undefined` when `sourceGet` throws so the caller can omit `loc`
 * from the metrics block while still emitting the node.
 *
 * The thunk shape lets the caller decide how to resolve the source
 * (overlay-first, disk fallback, etc.) and keeps this module free of
 * any workspace-state coupling. The catch is the only branch that
 * cannot be exercised through the public service surface — see
 * `tests/workspace-service.dependency-graph-loc.spec.ts` siblings for
 * the unit coverage.
 */
export function workspaceFileLineCountGet(
  sourceGet: () => string,
): number | undefined {
  let source: string;
  try {
    source = sourceGet();
  } catch {
    return undefined;
  }
  return dependencyGraphLineCountFromSource(source);
}

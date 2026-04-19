/**
 * Resolve `--entry` arguments to workspace URIs.
 *
 * Each argument is either:
 *
 * - a literal file path (relative to `cwd` or absolute), kept as-is and
 *   converted to a `file://` URI; or
 * - a glob pattern (any value containing `*`, `?`, `[`, or `{`), matched
 *   against the workspace-relative paths of every node in the supplied
 *   dependency graph.
 *
 * Glob expansion only consults the dependency graph — never the
 * filesystem — so the entry set always agrees with what the workspace
 * service actually indexed. A glob that matches nothing is reported via
 * {@link GraphEntryExpansion.unmatched} so callers can surface a typo
 * warning without aborting the whole run.
 */
import { minimatch } from 'minimatch';
import type { WorkspaceDependencyGraphNode } from '@codepol/core';
import { graphFileUriResolve } from './graphPathResolve';

export type GraphEntryExpansion = {
  /** URIs to treat as entry points, deduplicated and sorted. */
  uris: string[];
  /** Glob patterns supplied by the user that matched zero indexed files. */
  unmatched: string[];
};

const GLOB_META_REGEX = /[*?[\]{}]/;

export function graphEntryGlobIs(value: string): boolean {
  return GLOB_META_REGEX.test(value);
}

export function graphEntryUrisExpand(input: {
  cwd: string;
  entries: readonly string[];
  nodes: readonly WorkspaceDependencyGraphNode[];
}): GraphEntryExpansion {
  const matched = new Set<string>();
  const unmatched: string[] = [];
  for (const entry of input.entries) {
    if (!graphEntryGlobIs(entry)) {
      matched.add(graphFileUriResolve(input.cwd, entry));
      continue;
    }
    let foundAny = false;
    for (const node of input.nodes) {
      if (minimatch(node.workspaceRelativePath, entry, { dot: true })) {
        matched.add(node.uri);
        foundAny = true;
      }
    }
    if (!foundAny) unmatched.push(entry);
  }
  return {
    uris: Array.from(matched).sort(),
    unmatched,
  };
}

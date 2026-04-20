/**
 * Pure helpers for the per-file cycle gutter decoration.
 *
 * Phase 5 follow-up — Phase 6 has already shipped the
 * `codepol/architecture` diagnostic source for cycles, but a
 * per-file gutter marker that the user can hover for the cycle
 * member list is a separate editor surface. This helper does the
 * deterministic, side-effect-free bits:
 *
 * - membership lookup ("is this URI in any known cycle?")
 * - hover-card Markdown rendering ("here is the cycle the file is
 *   part of, with one trusted command link per member")
 *
 * The `CycleGutterDecorationController` owns the vscode side
 * (decoration type, document attach, refresh on readiness change)
 * and consumes these helpers. The split mirrors the
 * `importSpecifierMarkerController` / `importSpecifierMarkerLocate`
 * shape so both helpers can be unit-tested without a vscode runtime.
 */

export type CycleMembership = {
  /** Members of the cycle the focus URI belongs to (URIs). */
  cycleMembers: string[];
};

export type CycleMembershipLookup = {
  /**
   * Return cycle metadata when `uri` participates in any cycle, or
   * `null` when it does not. When the URI participates in multiple
   * cycles, returns the lexicographically-first cycle's members so
   * the hover stays deterministic.
   */
  uriIsInCycle(uri: string): CycleMembership | null;
};

/**
 * Build a lookup from a `WorkspaceDependencyGraphResult.cycles`
 * structure. The cycles are sorted ascending so the per-URI lookup is
 * deterministic when several cycles share members.
 */
export function cycleMembershipLookupCreate(
  cycles: readonly (readonly string[])[],
): CycleMembershipLookup {
  // Pre-index per URI for O(1) lookup. Each URI may belong to
  // several cycles; we keep them sorted lexicographically (by cycle
  // members joined) so the chosen cycle is deterministic across
  // runs.
  const sortedCycles = cycles
    .filter((cycle) => cycle.length > 1)
    .map((cycle) => [...cycle].sort())
    .sort((left, right) => {
      const leftKey = left.join('\u0000');
      const rightKey = right.join('\u0000');
      return leftKey.localeCompare(rightKey);
    });
  const cycleByUri = new Map<string, string[]>();
  for (const cycle of sortedCycles) {
    for (const uri of cycle) {
      if (!cycleByUri.has(uri)) {
        cycleByUri.set(uri, cycle);
      }
    }
  }
  return {
    uriIsInCycle(uri: string): CycleMembership | null {
      const members = cycleByUri.get(uri);
      if (!members) return null;
      return { cycleMembers: members };
    },
  };
}

/**
 * Render the gutter hover card. The Markdown body lists every
 * cycle member as a trusted command link to `peekCommandId` so the
 * user can jump from the hover into the architecture peek panel
 * focused on any member of the cycle.
 *
 * Constraints:
 * - The first line summarises the cycle size. Plural-aware.
 * - The focus file appears first in the list (so the user always sees
 *   themselves at the top of the membership), then the rest sorted
 *   lexicographically so the order is deterministic across runs.
 * - The hover never lists the focus file twice.
 * - Workspace-relative paths are surfaced (rather than full URIs) for
 *   readability; the URIs are encoded into the command link arguments
 *   so the click target is unambiguous.
 */
export function cycleHoverMarkdownCreate(input: {
  focusUri: string;
  cycleMembers: string[];
  workspaceRelativePathOf(uri: string): string;
  peekCommandId?: string;
}): string {
  const otherMembers = input.cycleMembers
    .filter((uri) => uri !== input.focusUri)
    .sort();
  // Always lead with the focus file so the user sees their position
  // in the cycle. Filter out the focus URI from the trailing list to
  // avoid duplicating it.
  const orderedMembers = [input.focusUri, ...otherMembers];
  const cycleSize = input.cycleMembers.length;
  const memberWord = cycleSize === 1 ? 'file' : 'files';
  const summaryLine = `Codepol cycle (${cycleSize} ${memberWord})`;
  const linkLines = orderedMembers.map((uri) => {
    const label = input.workspaceRelativePathOf(uri);
    if (input.peekCommandId) {
      const args = encodeURIComponent(JSON.stringify({ uri }));
      return `- [${label}](command:${input.peekCommandId}?${args})`;
    }
    return `- ${label}`;
  });
  return [`**${summaryLine}**`, '', ...linkLines].join('\n');
}

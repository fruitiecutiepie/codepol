/**
 * Pure helper behind the Phase 6 PR-aware diagnostic overlay.
 *
 * The extension subscribes to architecture-rule output through the
 * existing `codepol/architecture` diagnostic source; this overlay
 * complements that stream by warning about cycles and dead modules
 * that did NOT exist in a captured baseline snapshot. The helper takes
 * the diff and the live dead-modules result and produces a per-URI map
 * of warning diagnostics that the host class
 * (`architectureDiffOverlay.ts`) writes into a dedicated
 * `vscode.DiagnosticCollection`.
 *
 * The helper deliberately avoids any `vscode.*` import so the contract
 * (which URIs are flagged, which code/severity/source) can be exercised
 * in vitest without a fake VS Code runtime.
 */

import type {
  WorkspaceDeadModulesResult,
  WorkspaceDependencyDiffResult,
} from '@codepol/core';
import { CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE } from './constants';

/**
 * Severity tag emitted by the overlay. Plain string so callers can
 * map to either `vscode.DiagnosticSeverity.Warning` (in the live
 * extension) or any other host's severity enum (in tests).
 */
export type ArchitectureDiffOverlaySeverity = 'warning';

/**
 * Diagnostic codes the overlay produces. The cycle code wins when a
 * URI appears in BOTH the new-cycles and the new-dead-modules lists,
 * because the cycle warning carries `relatedUris` that point at the
 * other cycle members and is therefore strictly more informative.
 */
export type ArchitectureDiffOverlayDiagnosticCode =
  | 'architecture-cycle-new'
  | 'architecture-dead-new';

/**
 * Plain-shape diagnostic the overlay emits. Mirrors the subset of
 * `vscode.Diagnostic` the host needs; the host adapter wraps the
 * value in a `vscode.Diagnostic` before pushing into the collection.
 */
export type ArchitectureDiffOverlayDiagnostic = {
  source: typeof CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE;
  code: ArchitectureDiffOverlayDiagnosticCode;
  severity: ArchitectureDiffOverlaySeverity;
  message: string;
  /**
   * Other cycle members for `architecture-cycle-new` diagnostics
   * (anchor excluded). Empty for `architecture-dead-new`. Sorted
   * lexicographically so the host can produce stable
   * `relatedInformation` even across runs that hit the same diff.
   */
  relatedUris: string[];
  /**
   * URIs of every cycle member, anchor included, for the cycle
   * action that the host wires up via the trusted command link in
   * the diagnostic's hover Markdown. Empty for `architecture-dead-new`.
   */
  cycleMemberUris: string[];
};

export type ArchitectureDiffOverlayInput = {
  /**
   * Snapshot diff produced by `protocol.queryDependencyDiff`. May be
   * `null` when the baseline call failed; the helper treats that as
   * "no overlay" rather than an empty diff so we do not emit
   * misleading warnings while data is still loading.
   */
  diff: WorkspaceDependencyDiffResult | null;
  /**
   * Current dead-modules result, used to filter `addedNodes` down to
   * URIs the live workspace currently considers unreachable. May be
   * `null`; when absent, no dead-module warnings are emitted.
   */
  deadModules: WorkspaceDeadModulesResult | null;
  /**
   * Baseline label used in the message. The helper guards against an
   * empty label so a default-constructed setting cannot produce
   * confusing `"new since baseline """` messages.
   */
  baselineLabel: string;
};

/**
 * Build the overlay diagnostic map keyed by URI. The map is empty
 * when:
 *
 * - `baselineLabel` is the empty string (overlay is disabled by config)
 * - both `diff` and `deadModules` lookups failed
 * - the diff has no `newCycles` and no `addedNodes` overlap with the
 *   live dead-modules `unreachable` set
 *
 * Cycle-anchor URIs collide with dead-module URIs deterministically:
 * a URI that appears in both yields a single `architecture-cycle-new`
 * diagnostic (the cycle message strictly carries more context). All
 * other dead-module URIs get their own `architecture-dead-new`
 * diagnostic.
 */
export function architectureDiffOverlayDiagnosticsCreate(
  input: ArchitectureDiffOverlayInput,
): Map<string, ArchitectureDiffOverlayDiagnostic[]> {
  const map = new Map<string, ArchitectureDiffOverlayDiagnostic[]>();
  if (input.baselineLabel.trim().length === 0) return map;
  if (input.diff === null && input.deadModules === null) return map;

  const cycleAnchorUris = new Set<string>();
  if (input.diff) {
    for (const cycle of input.diff.newCycles) {
      const anchor = architectureDiffCycleAnchorPick(cycle);
      if (anchor === undefined) continue;
      const related = cycle.filter((uri) => uri !== anchor).sort();
      const cycleMembers = [anchor, ...related];
      cycleAnchorUris.add(anchor);
      const diagnostic: ArchitectureDiffOverlayDiagnostic = {
        source: CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE,
        code: 'architecture-cycle-new',
        severity: 'warning',
        message: architectureDiffCycleMessageCreate({
          cycleSize: cycle.length,
          baselineLabel: input.baselineLabel,
        }),
        relatedUris: related,
        cycleMemberUris: cycleMembers,
      };
      architectureDiffOverlayMapPush(map, anchor, diagnostic);
    }
  }

  if (input.deadModules) {
    const addedNodeUris = new Set<string>(
      (input.diff?.addedNodes ?? []).map((node) => node.uri),
    );
    for (const uri of input.deadModules.unreachable) {
      if (!addedNodeUris.has(uri)) continue;
      // A new cycle anchor already covers this URI with strictly more
      // context (`relatedUris` + cycle member list); don't double-tag.
      if (cycleAnchorUris.has(uri)) continue;
      const diagnostic: ArchitectureDiffOverlayDiagnostic = {
        source: CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE,
        code: 'architecture-dead-new',
        severity: 'warning',
        message: architectureDiffDeadMessageCreate({
          baselineLabel: input.baselineLabel,
        }),
        relatedUris: [],
        cycleMemberUris: [],
      };
      architectureDiffOverlayMapPush(map, uri, diagnostic);
    }
  }

  return map;
}

// ============================================================================
// Helpers
// ============================================================================

function architectureDiffCycleAnchorPick(cycle: readonly string[]): string | undefined {
  if (cycle.length === 0) return undefined;
  return [...cycle].sort()[0];
}

function architectureDiffCycleMessageCreate(input: {
  cycleSize: number;
  baselineLabel: string;
}): string {
  return `Circular import (${input.cycleSize} files) new since baseline "${input.baselineLabel}"`;
}

function architectureDiffDeadMessageCreate(input: {
  baselineLabel: string;
}): string {
  return `Dead module new since baseline "${input.baselineLabel}"`;
}

function architectureDiffOverlayMapPush(
  map: Map<string, ArchitectureDiffOverlayDiagnostic[]>,
  uri: string,
  diagnostic: ArchitectureDiffOverlayDiagnostic,
): void {
  const existing = map.get(uri);
  if (existing) {
    existing.push(diagnostic);
    return;
  }
  map.set(uri, [diagnostic]);
}

/**
 * Pure helpers behind the Phase 6 "Show full cycle" code action.
 *
 * The architecture analyzer publishes one diagnostic per cycle anchored
 * on the alphabetically-first cycle member, with the remaining members
 * exposed via `relatedInformation` (mapped from
 * `PolicyViolation.relatedLocations` by `policyViolationToWorkspaceDiagnostic`
 * and {@link diagnosticsToLsp}).
 *
 * The code action collects every member URI from one cycle diagnostic
 * (anchor + relateds) and forwards it to the new
 * `codepol.architecture.showCycle` command, which opens the
 * Architecture Links panel scoped to those URIs with the rest of the
 * graph dimmed.
 *
 * This helper deliberately speaks plain TypeScript shapes so the
 * provider implementation in `architectureCycleCodeActionProvider.ts`
 * is the only file that has to depend on the `vscode.*` runtime, which
 * keeps the Phase 6 action testable in the existing vitest suite
 * without a fake `vscode` shim.
 */

import { CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_CYCLE } from './constants';

/**
 * Diagnostic source emitted by the workspace-service architecture
 * analyzer. Mirrors `WORKSPACE_ARCHITECTURE_DIAGNOSTIC_SOURCE` in
 * `packages/workspace-service/src/index.ts`. Re-stated here so the
 * extension does not have to import the workspace-service runtime
 * just to read a string constant.
 */
export const ARCHITECTURE_DIAGNOSTIC_SOURCE = 'codepol/architecture';

/**
 * Suffix the architecture cycle rule is identified by. Cycle
 * violations land with `code` of either the rule's `id` field
 * (typically `no-cycles`) or the full rule id
 * (`@codepol/plugin/no-cycles`). Suffix matching tolerates both.
 */
const ARCHITECTURE_CYCLE_CODE_SUFFIX = 'no-cycles';

/**
 * Plain-TypeScript shape of the diagnostics the helper consumes.
 * Mirrors the subset of `vscode.Diagnostic` we need; the provider
 * adapts the live VS Code value to this shape before calling.
 */
export type ArchitectureCycleCodeActionDiagnostic = {
  source?: string;
  /** Diagnostic code; matches `WorkspaceDiagnostic.code`. */
  code?: string | number | { value: string | number };
  message: string;
  relatedInformation?: ReadonlyArray<{
    location: { uri: string };
  }>;
};

/**
 * Output shape of {@link architectureCycleCodeActionsCreate}. The
 * provider wraps each entry in a `vscode.CodeAction`.
 */
export type ArchitectureCycleCodeActionViewModel = {
  title: string;
  commandId: typeof CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_CYCLE;
  arguments: { memberUris: string[] };
};

/**
 * Predicate: is the diagnostic an architecture-cycle one we should
 * surface a "Show full cycle" action for?
 */
export function architectureCycleDiagnosticIs(
  diagnostic: ArchitectureCycleCodeActionDiagnostic,
): boolean {
  if (diagnostic.source !== ARCHITECTURE_DIAGNOSTIC_SOURCE) {
    return false;
  }
  const codeText = architectureDiagnosticCodeNormalize(diagnostic.code);
  if (codeText === undefined) return false;
  if (codeText === ARCHITECTURE_CYCLE_CODE_SUFFIX) return true;
  return codeText.endsWith(`/${ARCHITECTURE_CYCLE_CODE_SUFFIX}`);
}

/**
 * Build one "Show full cycle" code action per cycle diagnostic in the
 * incoming list.
 *
 * Rules:
 *
 * - Only diagnostics where {@link architectureCycleDiagnosticIs}
 *   returns `true` produce an action.
 * - Member URI list is `[anchorUri, ...uniqueRelatedUris]` with the
 *   anchor first (so the panel can pick it as the focus URI) and
 *   subsequent members in their original `relatedInformation` order
 *   minus duplicates. The anchor is deduped against the relateds so a
 *   self-referencing related does not appear twice.
 * - Diagnostics whose member set collapses to a single URI (i.e. no
 *   `relatedInformation`) are dropped because a one-file "cycle" is
 *   not meaningful and the existing per-file CodeLens already surfaces
 *   the architecture peek for that file.
 * - Multiple cycle diagnostics on the same document yield multiple
 *   actions, one per cycle, in input order. Their titles include the
 *   cycle size so users can distinguish "cycle of 3" from "cycle of 7"
 *   in the lightbulb menu.
 */
export function architectureCycleCodeActionsCreate(input: {
  diagnostics: ReadonlyArray<ArchitectureCycleCodeActionDiagnostic>;
  documentUri: string;
}): ArchitectureCycleCodeActionViewModel[] {
  const actions: ArchitectureCycleCodeActionViewModel[] = [];
  for (const diagnostic of input.diagnostics) {
    if (!architectureCycleDiagnosticIs(diagnostic)) continue;
    const memberUris = architectureCycleMemberUrisCollect({
      anchorUri: input.documentUri,
      relatedInformation: diagnostic.relatedInformation,
    });
    if (memberUris.length < 2) continue;
    actions.push({
      title: `Codepol: Show full cycle (${memberUris.length} files)`,
      commandId: CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_CYCLE,
      arguments: { memberUris },
    });
  }
  return actions;
}

// ============================================================================
// Helpers
// ============================================================================

function architectureDiagnosticCodeNormalize(
  code: ArchitectureCycleCodeActionDiagnostic['code'],
): string | undefined {
  if (code === undefined) return undefined;
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return String(code);
  if (typeof code === 'object' && code !== null) {
    return typeof code.value === 'string' ? code.value : String(code.value);
  }
  return undefined;
}

function architectureCycleMemberUrisCollect(input: {
  anchorUri: string;
  relatedInformation:
    | ReadonlyArray<{ location: { uri: string } }>
    | undefined;
}): string[] {
  const ordered: string[] = [input.anchorUri];
  const seen = new Set<string>([input.anchorUri]);
  for (const related of input.relatedInformation ?? []) {
    const uri = related.location?.uri;
    if (typeof uri !== 'string' || uri.length === 0) continue;
    if (seen.has(uri)) continue;
    seen.add(uri);
    ordered.push(uri);
  }
  return ordered;
}

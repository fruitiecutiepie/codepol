/**
 * Phase 6 unit tests for the diff-overlay view-model helper that
 * powers the "new since baseline" Problems-panel entries.
 *
 * The host class
 * (`extension-vscode/src/architectureDiffOverlay.ts`) writes the helper
 * output into a `vscode.DiagnosticCollection`; keeping this layer pure
 * means the contract (which URIs get a warning, which code, which
 * message, dedupe rules) stays under unit-test control without a fake
 * VS Code runtime.
 */

import { describe, expect, it } from 'vitest';
import type {
  WorkspaceDeadModulesResult,
  WorkspaceDependencyDiffResult,
} from '@codepol/core';
import { architectureDiffOverlayDiagnosticsCreate } from '../extension-vscode/src/architectureDiffOverlayViewModel';
import { CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE } from '../extension-vscode/src/constants';

const A_URI = 'file:///workspace/src/a.ts';
const B_URI = 'file:///workspace/src/b.ts';
const C_URI = 'file:///workspace/src/c.ts';
const ORPHAN_URI = 'file:///workspace/src/orphan.ts';

function diffCreate(
  overrides: Partial<WorkspaceDependencyDiffResult> = {},
): WorkspaceDependencyDiffResult {
  return {
    workspaceId: 'workspace-1',
    currentAnalysisGeneration: 1,
    addedNodes: [],
    removedNodes: [],
    addedEdges: [],
    removedEdges: [],
    newCycles: [],
    removedCycles: [],
    ...overrides,
  };
}

function deadCreate(
  unreachable: string[] = [],
): WorkspaceDeadModulesResult {
  return { unreachable };
}

describe('architectureDiffOverlayDiagnosticsCreate', () => {
  it('returns an empty map when the baseline label is empty', () => {
    expect(
      architectureDiffOverlayDiagnosticsCreate({
        diff: diffCreate({
          newCycles: [[A_URI, B_URI]],
        }),
        deadModules: deadCreate([ORPHAN_URI]),
        baselineLabel: '',
      }).size,
    ).toBe(0);

    expect(
      architectureDiffOverlayDiagnosticsCreate({
        diff: diffCreate({
          newCycles: [[A_URI, B_URI]],
        }),
        deadModules: deadCreate([ORPHAN_URI]),
        baselineLabel: '   ',
      }).size,
    ).toBe(0);
  });

  it('returns an empty map when both diff and deadModules failed to load', () => {
    expect(
      architectureDiffOverlayDiagnosticsCreate({
        diff: null,
        deadModules: null,
        baselineLabel: 'base',
      }).size,
    ).toBe(0);
  });

  it('emits one architecture-cycle-new warning per new cycle anchored on the alphabetically-first member', () => {
    // Pass cycle members in non-sorted order to lock the anchor pick.
    const map = architectureDiffOverlayDiagnosticsCreate({
      diff: diffCreate({
        newCycles: [[B_URI, A_URI, C_URI]],
      }),
      deadModules: deadCreate([]),
      baselineLabel: 'base',
    });

    expect([...map.keys()]).toEqual([A_URI]);
    const [diagnostic] = map.get(A_URI)!;
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.source).toBe(
      CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE,
    );
    expect(diagnostic!.code).toBe('architecture-cycle-new');
    expect(diagnostic!.severity).toBe('warning');
    expect(diagnostic!.message).toBe(
      'Circular import (3 files) new since baseline "base"',
    );
    expect(diagnostic!.relatedUris).toEqual([B_URI, C_URI]);
    expect(diagnostic!.cycleMemberUris).toEqual([A_URI, B_URI, C_URI]);
  });

  it('emits architecture-dead-new warnings for added nodes that the live workspace marks unreachable', () => {
    const map = architectureDiffOverlayDiagnosticsCreate({
      diff: diffCreate({
        addedNodes: [
          { uri: ORPHAN_URI, workspaceRelativePath: 'src/orphan.ts' },
        ],
      }),
      deadModules: deadCreate([ORPHAN_URI]),
      baselineLabel: 'base',
    });

    expect([...map.keys()]).toEqual([ORPHAN_URI]);
    const [diagnostic] = map.get(ORPHAN_URI)!;
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.source).toBe(
      CODEPOL_ARCHITECTURE_NEW_SINCE_BASELINE_DIAGNOSTIC_SOURCE,
    );
    expect(diagnostic!.code).toBe('architecture-dead-new');
    expect(diagnostic!.message).toBe('Dead module new since baseline "base"');
    expect(diagnostic!.relatedUris).toEqual([]);
    expect(diagnostic!.cycleMemberUris).toEqual([]);
  });

  it('drops unreachable URIs that are not in the diff addedNodes (pre-existing dead modules stay silent)', () => {
    // ORPHAN_URI is unreachable today but did NOT appear in addedNodes,
    // so the overlay must not warn on it (the regular
    // codepol/architecture dead-module diagnostic already covers it).
    const map = architectureDiffOverlayDiagnosticsCreate({
      diff: diffCreate({
        addedNodes: [],
      }),
      deadModules: deadCreate([ORPHAN_URI]),
      baselineLabel: 'base',
    });
    expect(map.size).toBe(0);
  });

  it('collapses a URI that is both a new cycle anchor and a new dead module into one cycle warning', () => {
    // A_URI is the cycle anchor AND appears in the added/dead lists.
    // The overlay should keep only the cycle warning since it carries
    // strictly more context (related members, cycle hover link).
    const map = architectureDiffOverlayDiagnosticsCreate({
      diff: diffCreate({
        newCycles: [[A_URI, B_URI]],
        addedNodes: [
          { uri: A_URI, workspaceRelativePath: 'src/a.ts' },
        ],
      }),
      deadModules: deadCreate([A_URI]),
      baselineLabel: 'base',
    });

    expect(map.size).toBe(1);
    const diagnostics = map.get(A_URI)!;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('architecture-cycle-new');
  });

  it('produces no dead-module warning when deadModules data is unavailable', () => {
    const map = architectureDiffOverlayDiagnosticsCreate({
      diff: diffCreate({
        addedNodes: [
          { uri: ORPHAN_URI, workspaceRelativePath: 'src/orphan.ts' },
        ],
      }),
      deadModules: null,
      baselineLabel: 'base',
    });
    expect(map.size).toBe(0);
  });

  it('emits a warning for every member of a multi-cycle workspace, anchored deterministically', () => {
    const map = architectureDiffOverlayDiagnosticsCreate({
      diff: diffCreate({
        newCycles: [
          [B_URI, A_URI],
          [C_URI, B_URI],
        ],
      }),
      deadModules: deadCreate([]),
      baselineLabel: 'base',
    });
    // Anchors: cycle 1 -> A_URI, cycle 2 -> B_URI.
    expect([...map.keys()].sort()).toEqual([A_URI, B_URI].sort());
    expect(map.get(A_URI)![0]!.relatedUris).toEqual([B_URI]);
    expect(map.get(B_URI)![0]!.relatedUris).toEqual([C_URI]);
  });
});

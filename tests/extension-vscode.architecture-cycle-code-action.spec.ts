/**
 * Phase 6 unit tests for the cycle code-action helper that backs the
 * "Show full cycle" lightbulb action on `codepol/architecture`
 * diagnostics.
 *
 * The helper is the only place that decides which diagnostics earn an
 * action and how member URIs flow into the
 * `codepol.architecture.showCycle` command. Keeping it pure means the
 * provider in `architectureCycleCodeActionProvider.ts` stays a thin
 * `vscode.*` adapter and the contract is exercised here without a fake
 * VS Code runtime.
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_DIAGNOSTIC_SOURCE,
  architectureCycleCodeActionsCreate,
  architectureCycleDiagnosticIs,
  type ArchitectureCycleCodeActionDiagnostic,
} from '../extension-vscode/src/architectureCycleCodeActionViewModel';
import { CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_CYCLE } from '../extension-vscode/src/constants';

const A_URI = 'file:///workspace/src/a.ts';
const B_URI = 'file:///workspace/src/b.ts';
const C_URI = 'file:///workspace/src/c.ts';

function cycleDiagnosticCreate(input: {
  code?: ArchitectureCycleCodeActionDiagnostic['code'];
  source?: string;
  members?: string[];
  message?: string;
}): ArchitectureCycleCodeActionDiagnostic {
  return {
    source: input.source ?? ARCHITECTURE_DIAGNOSTIC_SOURCE,
    code: input.code ?? 'no-cycles',
    message:
      input.message ?? `Circular import (${(input.members ?? []).length} files)`,
    relatedInformation: (input.members ?? []).map((uri) => ({
      location: { uri },
    })),
  };
}

describe('architectureCycleDiagnosticIs', () => {
  it('matches diagnostics with the architecture source and the no-cycles short id', () => {
    expect(
      architectureCycleDiagnosticIs(
        cycleDiagnosticCreate({ code: 'no-cycles', members: [B_URI] }),
      ),
    ).toBe(true);
  });

  it('matches diagnostics with the architecture source and a namespaced rule id suffix', () => {
    expect(
      architectureCycleDiagnosticIs(
        cycleDiagnosticCreate({
          code: '@codepol/plugin/no-cycles',
          members: [B_URI],
        }),
      ),
    ).toBe(true);
  });

  it('rejects diagnostics from other sources even when the code looks like a cycle', () => {
    expect(
      architectureCycleDiagnosticIs(
        cycleDiagnosticCreate({ source: 'codepol', code: 'no-cycles' }),
      ),
    ).toBe(false);
  });

  it('rejects architecture diagnostics whose code is not the cycle rule', () => {
    expect(
      architectureCycleDiagnosticIs(
        cycleDiagnosticCreate({ code: 'dead-module' }),
      ),
    ).toBe(false);
  });

  it('handles diagnostic codes wrapped in the LSP `{value, target}` shape', () => {
    expect(
      architectureCycleDiagnosticIs({
        source: ARCHITECTURE_DIAGNOSTIC_SOURCE,
        code: { value: '@codepol/plugin/no-cycles' },
        message: 'Circular import',
        relatedInformation: [{ location: { uri: B_URI } }],
      }),
    ).toBe(true);
  });
});

describe('architectureCycleCodeActionsCreate', () => {
  it('returns an empty list when nothing matches', () => {
    expect(
      architectureCycleCodeActionsCreate({
        diagnostics: [
          cycleDiagnosticCreate({ source: 'codepol' }),
          cycleDiagnosticCreate({ code: 'dead-module' }),
        ],
        documentUri: A_URI,
      }),
    ).toEqual([]);
  });

  it('drops cycle diagnostics that do not point at any other member', () => {
    // No relatedInformation -> would collapse to a one-file "cycle"
    // which is not actionable; the per-file CodeLens already covers
    // navigating that file.
    expect(
      architectureCycleCodeActionsCreate({
        diagnostics: [cycleDiagnosticCreate({ members: [] })],
        documentUri: A_URI,
      }),
    ).toEqual([]);
  });

  it('emits one action per cycle with the anchor URI first and dedupes related URIs', () => {
    // Diagnostic anchored on A with related members {B, C} (and a
    // duplicate of A in relatedInformation just to exercise the dedupe).
    const actions = architectureCycleCodeActionsCreate({
      diagnostics: [
        cycleDiagnosticCreate({ members: [B_URI, A_URI, C_URI, B_URI] }),
      ],
      documentUri: A_URI,
    });
    expect(actions).toEqual([
      {
        title: 'Codepol: Show full cycle (3 files)',
        commandId: CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_CYCLE,
        arguments: { memberUris: [A_URI, B_URI, C_URI] },
      },
    ]);
  });

  it('emits multiple actions when a single document hosts more than one cycle', () => {
    const actions = architectureCycleCodeActionsCreate({
      diagnostics: [
        cycleDiagnosticCreate({ members: [B_URI] }),
        cycleDiagnosticCreate({ members: [C_URI] }),
      ],
      documentUri: A_URI,
    });
    expect(actions.map((action) => action.arguments.memberUris)).toEqual([
      [A_URI, B_URI],
      [A_URI, C_URI],
    ]);
    // Titles include the cycle size so the lightbulb menu is
    // disambiguated even when a file participates in several cycles.
    expect(actions[0]!.title).toBe('Codepol: Show full cycle (2 files)');
    expect(actions[1]!.title).toBe('Codepol: Show full cycle (2 files)');
  });

  it('tolerates undefined / missing relatedInformation entries', () => {
    expect(
      architectureCycleCodeActionsCreate({
        diagnostics: [
          {
            source: ARCHITECTURE_DIAGNOSTIC_SOURCE,
            code: 'no-cycles',
            message: 'Circular import',
            // relatedInformation deliberately omitted.
          },
        ],
        documentUri: A_URI,
      }),
    ).toEqual([]);
  });
});

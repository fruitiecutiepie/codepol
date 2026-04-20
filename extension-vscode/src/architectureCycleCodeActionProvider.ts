/**
 * VS Code provider that surfaces the Phase 6 "Show full cycle"
 * lightbulb action on `codepol/architecture` cycle diagnostics.
 *
 * The provider is intentionally a thin shell over
 * {@link architectureCycleCodeActionsCreate}: it adapts incoming
 * `vscode.Diagnostic` values into the helper's plain shape, then maps
 * each helper output back into a `vscode.CodeAction` wired to the
 * `codepol.architecture.showCycle` command. Keeping the policy in the
 * pure helper means the unit tests in
 * `tests/extension-vscode.architecture-cycle-code-action.spec.ts` are
 * the source of truth for which diagnostics earn an action and how
 * member URIs are collected.
 */

import * as vscode from 'vscode';
import {
  architectureCycleCodeActionsCreate,
  type ArchitectureCycleCodeActionDiagnostic,
} from './architectureCycleCodeActionViewModel';

/**
 * Code action kind for the "Show full cycle" action. Ships under
 * `quickfix.architecture.cycle` so users can bind it to the existing
 * `editor.action.quickFix` command and gate it through `codeActionsOnSave`
 * filters if they want.
 */
export const ARCHITECTURE_CYCLE_CODE_ACTION_KIND =
  vscode.CodeActionKind.QuickFix.append('architecture').append('cycle');

export class CodepolArchitectureCycleCodeActionProvider
  implements vscode.CodeActionProvider
{
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [ARCHITECTURE_CYCLE_CODE_ACTION_KIND],
  };

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (document.uri.scheme !== 'file') {
      return [];
    }
    const documentUri = document.uri.toString();
    const diagnostics: ArchitectureCycleCodeActionDiagnostic[] =
      context.diagnostics.map(architectureCycleDiagnosticAdapt);
    const actions = architectureCycleCodeActionsCreate({
      diagnostics,
      documentUri,
    });
    return actions.map((action) => {
      const codeAction = new vscode.CodeAction(
        action.title,
        ARCHITECTURE_CYCLE_CODE_ACTION_KIND,
      );
      codeAction.command = {
        title: action.title,
        command: action.commandId,
        arguments: [action.arguments],
      };
      return codeAction;
    });
  }
}

/**
 * Map a `vscode.Diagnostic` to the plain shape the pure helper consumes.
 * Kept in this file (not the helper) so the helper can stay free of
 * any `vscode.*` dependency.
 */
function architectureCycleDiagnosticAdapt(
  diagnostic: vscode.Diagnostic,
): ArchitectureCycleCodeActionDiagnostic {
  return {
    source: diagnostic.source,
    code: architectureCycleDiagnosticCodeAdapt(diagnostic.code),
    message: diagnostic.message,
    relatedInformation: (diagnostic.relatedInformation ?? []).map((related) => ({
      location: { uri: related.location.uri.toString() },
    })),
  };
}

function architectureCycleDiagnosticCodeAdapt(
  code: vscode.Diagnostic['code'],
): ArchitectureCycleCodeActionDiagnostic['code'] {
  if (code === undefined) return undefined;
  if (typeof code === 'string' || typeof code === 'number') {
    return code;
  }
  if (typeof code === 'object' && code !== null && 'value' in code) {
    const value = (code as { value: string | number }).value;
    return { value };
  }
  return undefined;
}

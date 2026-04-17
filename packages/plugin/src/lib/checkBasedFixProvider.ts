/**
 * Shared FixProvider runner for rules whose autofix logic lives entirely
 * inside their {@link TreeCheckProvider} as `violation.fix.edits`. Reuses
 * the rule's check to produce edits, then writes them to disk.
 */

import fs from 'node:fs';
import {
  fileWorkspaceEditsApply,
  fileWorkspaceEditsNormalize,
  langIdGetForFile,
  type FixProviderContext,
  type PolicyCheckContext,
  type PolicyRule,
  type PolicyRuleTarget,
  type PolicyViolation,
  type PolicyWorkspaceEdit,
  type TreeCheckFn,
} from '@codepol/core';

type CheckBasedFixProviderOptions = {
  /**
   * Trailing rule id segment (e.g. `enforce-casing`). Matched against
   * `ruleTargets[].ruleId` either by exact equality or `endsWith('/' + idSuffix)`.
   */
  ruleIdSuffix: string;
  /** Languages this rule supports; files of other languages are skipped. */
  supportedLanguages: readonly string[];
  /** The rule's check function. Must return per-file violations with `fix.edits` populated. */
  check: TreeCheckFn;
};

function ruleTargetsForSuffix(
  context: FixProviderContext,
  ruleIdSuffix: string,
): NonNullable<FixProviderContext['ruleTargets']> {
  const targets = context.ruleTargets ?? [];
  return targets.filter(
    (t) => t.ruleId === ruleIdSuffix || t.ruleId.endsWith('/' + ruleIdSuffix),
  );
}

function violationEditsCollect(violation: PolicyViolation): PolicyWorkspaceEdit[] {
  const fix = violation.fix;
  if (!fix) {
    return [];
  }
  if (fix.edits && fix.edits.length > 0) {
    return fix.edits;
  }
  return [
    {
      filePath: violation.filePath,
      byteRange: fix.byteRange,
      text: fix.text,
    },
  ];
}

export function policyFixApplyFromCheck(
  context: FixProviderContext,
  options: CheckBasedFixProviderOptions,
): void {
  const ruleTargets = ruleTargetsForSuffix(context, options.ruleIdSuffix);
  if (ruleTargets.length === 0) {
    return;
  }

  const supportedLanguages = new Set(options.supportedLanguages);
  const editsByFile = new Map<string, PolicyWorkspaceEdit[]>();

  for (const filePath of context.files) {
    const language = langIdGetForFile(filePath);
    if (!language || !supportedLanguages.has(language)) {
      continue;
    }

    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const ruleTarget of ruleTargets) {
      const target: PolicyRuleTarget = { ...ruleTarget.target, language };
      const checkContext: PolicyCheckContext = {
        filePath,
        source,
        policy: context.policy,
        dir: context.cwd,
        configPath: context.configPath,
        target,
        ruleArgs: ruleTarget.args,
        projectIndex: context.projectIndex,
      };
      const rule: PolicyRule = {
        ruleId: ruleTarget.ruleId,
        targets: [],
        args: ruleTarget.args,
        description: ruleTarget.description,
      };

      let violations: PolicyViolation[];
      try {
        violations = options.check(rule, checkContext);
      } catch {
        continue;
      }

      for (const violation of violations) {
        for (const edit of violationEditsCollect(violation)) {
          const list = editsByFile.get(edit.filePath) ?? [];
          list.push(edit);
          editsByFile.set(edit.filePath, list);
        }
      }
    }
  }

  for (const [filePath, fileEdits] of editsByFile) {
    const normalized = fileWorkspaceEditsNormalize(fileEdits);
    if ('Err' in normalized) {
      continue;
    }
    if (normalized.Ok.length === 0) {
      continue;
    }

    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const next = fileWorkspaceEditsApply(source, normalized.Ok);
    if (next === source) {
      continue;
    }

    fs.writeFileSync(filePath, next, 'utf8');
  }
}

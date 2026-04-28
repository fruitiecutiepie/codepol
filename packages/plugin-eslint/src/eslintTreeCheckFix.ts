/**
 * Maps {@link PolicyViolationFix} to ESLint's fixer callback. ESLint can only apply
 * fixes in the current file; multi-file {@link PolicyViolationFix.edits} must not
 * partially apply the primary range only.
 */

import path from 'node:path';
import type { TSESLint } from '@typescript-eslint/utils';
import {
  fileWorkspaceEditsNormalize,
  isErr,
  type PolicyViolationFix,
  type PolicyWorkspaceEdit,
} from '@codepol/core';

function byteRangeIsValid(edit: PolicyWorkspaceEdit): boolean {
  return (
    Number.isFinite(edit.byteRange.start) &&
    Number.isFinite(edit.byteRange.end) &&
    edit.byteRange.start <= edit.byteRange.end
  );
}

export function eslintFixFromTreeCheckFix(
  currentFilePath: string,
  fix: PolicyViolationFix,
): TSESLint.ReportFixFunction | undefined {
  const resolved = path.resolve(currentFilePath);

  if (fix.edits && fix.edits.length > 0) {
    const byFile = new Map<string, NonNullable<PolicyViolationFix['edits']>>();
    for (const e of fix.edits) {
      const fp = path.resolve(e.filePath);
      const list = byFile.get(fp) ?? [];
      list.push(e);
      byFile.set(fp, list);
    }
    if (byFile.size !== 1 || !byFile.has(resolved)) {
      return undefined;
    }
    const normalized = fileWorkspaceEditsNormalize(byFile.get(resolved)!, {
      rejectOverlaps: true,
    });
    if (
      isErr(normalized) ||
      normalized.Ok.some((edit) => !byteRangeIsValid(edit))
    ) {
      // ESLint throws when one report returns overlapping fix objects.
      return undefined;
    }
    const edits = normalized.Ok;
    return (fixer) => {
      const parts: ReturnType<TSESLint.RuleFixer['replaceTextRange']>[] = [];
      for (const e of edits) {
        parts.push(
          fixer.replaceTextRange([e.byteRange.start, e.byteRange.end], e.text),
        );
      }
      return parts;
    };
  }

  if (
    fix.byteRange.start > fix.byteRange.end ||
    !Number.isFinite(fix.byteRange.start) ||
    !Number.isFinite(fix.byteRange.end)
  ) {
    return undefined;
  }

  return (fixer) =>
    fixer.replaceTextRange([fix.byteRange.start, fix.byteRange.end], fix.text);
}

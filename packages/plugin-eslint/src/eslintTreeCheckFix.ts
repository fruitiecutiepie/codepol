/**
 * Maps {@link PolicyViolationFix} to ESLint's fixer callback. ESLint can only apply
 * fixes in the current file; multi-file {@link PolicyViolationFix.edits} must not
 * partially apply the primary range only.
 */

import path from 'node:path';
import type { TSESLint } from '@typescript-eslint/utils';
import type { PolicyViolationFix } from '@codepol/core';

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
    const edits = byFile.get(resolved)!;
    edits.sort((a, b) => b.byteRange.start - a.byteRange.start);
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

  return (fixer) =>
    fixer.replaceTextRange([fix.byteRange.start, fix.byteRange.end], fix.text);
}

/**
 * Tree-check implementation for `python-dead-code`: runs Vulture per file.
 */

import type { PolicyCheckContext, PolicyRule, PolicyViolation } from '@codepol/core';
import { isErr } from '@codepol/core';
import { vultureFindingToViolation, vultureFindingsGet } from './vultureRunner';
import type { VultureProviderConfig } from './vultureTypes';
import { vultureFindingMatchesFile } from './vulturePathMatch';

export function pythonDeadCodeCheck(
  rule: PolicyRule,
  context: PolicyCheckContext,
): PolicyViolation[] {
  const fp = context.filePath;
  if (!fp.endsWith('.py') && !fp.endsWith('.pyw')) {
    return [];
  }

  const args = context.ruleArgs as VultureProviderConfig | undefined;
  const result = vultureFindingsGet([fp], args);
  if (isErr(result)) {
    const err = result.Err;
    if (/ENOENT|not found|Failed to execute vulture/i.test(err)) {
      console.warn(`[python-dead-code] ${err}`);
      return [];
    }
    throw new Error(err);
  }

  const ruleId = rule.ruleId;
  return result.Ok
    .filter(f => vultureFindingMatchesFile(f.filePath, fp))
    .map(f => vultureFindingToViolation(f, ruleId));
}

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Err,
  Ok,
  fileWorkspaceEditsApply,
  fileWorkspaceEditsNormalize,
  type PolicyViolation,
  type PolicyViolationFix,
  type PolicyWorkspaceEdit,
  type Result,
  type WorkspaceCodeAction,
  type WorkspaceCodeActionConflict,
  type WorkspaceDiagnostic,
  type WorkspaceEdit,
  type WorkspaceEditPlan,
  workspacePathToUri,
  workspaceRangeFromByteRange,
} from '@codepol/core';

export { fileWorkspaceEditsApply, fileWorkspaceEditsNormalize };

export function policyViolationWorkspaceEditsGet(
  violation: PolicyViolation,
): PolicyWorkspaceEdit[] {
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

function policyFixWorkspaceEditsGet(
  filePath: string,
  fix: PolicyViolationFix,
): PolicyWorkspaceEdit[] {
  if (fix.edits && fix.edits.length > 0) {
    return fix.edits;
  }
  return [
    {
      filePath,
      byteRange: fix.byteRange,
      text: fix.text,
    },
  ];
}

export function treeCheckFixesApply(violations: PolicyViolation[]): boolean {
  const editsByFile = new Map<string, PolicyWorkspaceEdit[]>();

  for (const violation of violations) {
    for (const edit of policyViolationWorkspaceEditsGet(violation)) {
      const list = editsByFile.get(edit.filePath) ?? [];
      list.push(edit);
      editsByFile.set(edit.filePath, list);
    }
  }

  let changed = false;
  for (const [filePath, fileEdits] of editsByFile) {
    const normalizedResult = fileWorkspaceEditsNormalize(fileEdits);
    if ('Err' in normalizedResult) {
      continue;
    }
    const normalized = normalizedResult.Ok;
    if (normalized.length === 0) {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const next = fileWorkspaceEditsApply(source, normalized);
    if (next === source) {
      continue;
    }

    fs.writeFileSync(filePath, next, 'utf8');
    changed = true;
  }

  return changed;
}

function workspaceEditsCreate(
  editsByFile: Map<string, PolicyWorkspaceEdit[]>,
  sourceGet: (filePath: string) => string,
): Result<WorkspaceEdit[], string> {
  const workspaceEdits: WorkspaceEdit[] = [];

  for (const [filePath, fileEdits] of editsByFile) {
    const normalizedResult = fileWorkspaceEditsNormalize(fileEdits, {
      rejectOverlaps: true,
    });
    if ('Err' in normalizedResult) {
      return Err(normalizedResult.Err ?? 'Failed to normalize workspace edits.');
    }

    const source = sourceGet(filePath);
    for (const edit of normalizedResult.Ok) {
      workspaceEdits.push({
        uri: workspacePathToUri(filePath),
        range: workspaceRangeFromByteRange(source, edit.byteRange),
        newText: edit.text,
      });
    }
  }

  return Ok(workspaceEdits);
}

export function workspaceEditPlanCreateFromFix(
  options: {
    filePath: string;
    fix: PolicyViolationFix;
    title: string;
    diagnostic: WorkspaceDiagnostic;
    sourceGet: (filePath: string) => string;
    idSalt?: string;
    isPreferred?: boolean;
  },
): Result<WorkspaceEditPlan, string> {
  const flatEdits = policyFixWorkspaceEditsGet(options.filePath, options.fix);
  const editsByFile = new Map<string, PolicyWorkspaceEdit[]>();
  for (const edit of flatEdits) {
    const list = editsByFile.get(edit.filePath) ?? [];
    list.push(edit);
    editsByFile.set(edit.filePath, list);
  }

  const workspaceEditsResult = workspaceEditsCreate(editsByFile, options.sourceGet);
  if ('Err' in workspaceEditsResult) {
    return Err(workspaceEditsResult.Err ?? 'Failed to create workspace edit plan.');
  }

  const id = createHash('sha256')
    .update(options.idSalt ?? '')
    .update('\0')
    .update(options.title)
    .update('\0')
    .update(JSON.stringify(workspaceEditsResult.Ok))
    .digest('hex')
    .slice(0, 16);

  return Ok({
    id,
    title: options.title,
    kind: 'quickfix',
    edits: workspaceEditsResult.Ok,
    diagnosticIds: [options.diagnostic.id],
    isPreferred: options.isPreferred,
  });
}

/**
 * One contribution to a fix-all plan: the attributed rule, the diagnostic id
 * being fixed, and its flat set of per-file workspace edits.
 */
type FixAllContribution = {
  ruleId: string;
  diagnosticId: string;
  edits: PolicyWorkspaceEdit[];
};

function fixAllContributionCompare(
  a: FixAllContribution,
  b: FixAllContribution,
): number {
  const ae = a.edits[0];
  const be = b.edits[0];
  if (!ae || !be) {
    return a.ruleId.localeCompare(b.ruleId);
  }
  if (ae.filePath !== be.filePath) {
    return ae.filePath.localeCompare(be.filePath);
  }
  if (ae.byteRange.start !== be.byteRange.start) {
    return ae.byteRange.start - be.byteRange.start;
  }
  if (ae.byteRange.end !== be.byteRange.end) {
    return ae.byteRange.end - be.byteRange.end;
  }
  return a.ruleId.localeCompare(b.ruleId);
}

function contributionEditsOverlap(
  a: PolicyWorkspaceEdit,
  b: PolicyWorkspaceEdit,
): boolean {
  if (a.filePath !== b.filePath) {
    return false;
  }
  return a.byteRange.start < b.byteRange.end && b.byteRange.start < a.byteRange.end;
}

/**
 * Build a `source.fixAll` / `source.fixAll.rule` code action by merging
 * attributed per-rule fix edits deterministically.
 *
 * First contribution wins on overlap; dropped overlaps are recorded on the
 * returned action as {@link WorkspaceCodeActionConflict} entries so the
 * caller can surface them without failing the save.
 *
 * Returns `null` when no contributions survive (nothing to do).
 */
export function workspaceFixAllActionCreate(
  options: {
    title: string;
    kind: 'source.fixAll' | 'source.fixAll.rule';
    ruleId?: string;
    contributions: FixAllContribution[];
    sourceGet: (filePath: string) => string;
    idSalt?: string;
  },
): Result<WorkspaceCodeAction | null, string> {
  const contributions = options.contributions
    .filter((contribution) => contribution.edits.length > 0)
    .sort(fixAllContributionCompare);

  const acceptedByFile = new Map<string, PolicyWorkspaceEdit[]>();
  const conflicts: WorkspaceCodeActionConflict[] = [];
  const diagnosticIds: string[] = [];
  const seenDiagnosticIds = new Set<string>();

  for (const contribution of contributions) {
    let contributionAccepted = false;
    for (const edit of contribution.edits) {
      const accepted = acceptedByFile.get(edit.filePath) ?? [];
      const overlap = accepted.find((existing) => contributionEditsOverlap(existing, edit));
      if (overlap) {
        conflicts.push({
          uri: workspacePathToUri(edit.filePath),
          firstByteRange: { ...overlap.byteRange },
          secondByteRange: { ...edit.byteRange },
          droppedRuleId: contribution.ruleId,
        });
        continue;
      }
      accepted.push(edit);
      acceptedByFile.set(edit.filePath, accepted);
      contributionAccepted = true;
    }

    if (contributionAccepted && !seenDiagnosticIds.has(contribution.diagnosticId)) {
      diagnosticIds.push(contribution.diagnosticId);
      seenDiagnosticIds.add(contribution.diagnosticId);
    }
  }

  if (acceptedByFile.size === 0) {
    return Ok(null);
  }

  const workspaceEditsResult = workspaceEditsCreate(acceptedByFile, options.sourceGet);
  if ('Err' in workspaceEditsResult) {
    return Err(workspaceEditsResult.Err ?? 'Failed to create fix-all plan.');
  }

  const planId = createHash('sha256')
    .update(options.idSalt ?? '')
    .update('\0')
    .update(options.kind)
    .update('\0')
    .update(options.ruleId ?? '')
    .update('\0')
    .update(JSON.stringify(workspaceEditsResult.Ok))
    .digest('hex')
    .slice(0, 16);

  const plan: WorkspaceEditPlan = {
    id: planId,
    title: options.title,
    kind: 'source.fixAll',
    edits: workspaceEditsResult.Ok,
    diagnosticIds,
  };

  const action: WorkspaceCodeAction = {
    id: planId,
    title: options.title,
    kind: options.kind,
    diagnosticIds,
    plan,
    ruleId: options.kind === 'source.fixAll.rule' ? options.ruleId : undefined,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };

  return Ok(action);
}

/**
 * Turn a {@link PolicyViolation} with `.fix` into a fix-all contribution
 * keyed by its originating rule. Returns `null` when the violation has no
 * auto-fix attached.
 */
export function fixAllContributionFromViolation(
  violation: PolicyViolation,
  diagnosticId: string,
): FixAllContribution | null {
  if (!violation.fix) {
    return null;
  }
  const edits = policyFixWorkspaceEditsGet(violation.filePath, violation.fix);
  if (edits.length === 0) {
    return null;
  }
  return {
    ruleId: violation.ruleId,
    diagnosticId,
    edits,
  };
}

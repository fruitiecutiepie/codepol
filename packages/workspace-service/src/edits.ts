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

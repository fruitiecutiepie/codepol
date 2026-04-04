import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Err,
  Ok,
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

export function fileWorkspaceEditsNormalize(
  edits: PolicyWorkspaceEdit[],
  options: { rejectOverlaps?: boolean } = {},
): Result<PolicyWorkspaceEdit[], string> {
  const sorted = [...edits].sort((a, b) => {
    if (a.byteRange.start !== b.byteRange.start) {
      return a.byteRange.start - b.byteRange.start;
    }
    if (a.byteRange.end !== b.byteRange.end) {
      return a.byteRange.end - b.byteRange.end;
    }
    return a.text.localeCompare(b.text);
  });

  const normalized: PolicyWorkspaceEdit[] = [];
  for (const edit of sorted) {
    const prev = normalized[normalized.length - 1];
    if (
      prev &&
      prev.byteRange.start === edit.byteRange.start &&
      prev.byteRange.end === edit.byteRange.end &&
      prev.text === edit.text
    ) {
      continue;
    }
    if (prev && edit.byteRange.start < prev.byteRange.end) {
      if (options.rejectOverlaps) {
        return Err(`Overlapping edits detected for ${edit.filePath}.`);
      }
      continue;
    }
    normalized.push(edit);
  }

  return Ok(normalized);
}

export function fileWorkspaceEditsApply(
  source: string,
  edits: PolicyWorkspaceEdit[],
): string {
  if (edits.length === 0) {
    return source;
  }

  const input = Buffer.from(source, 'utf8');
  const chunks: Buffer[] = [];
  let cursor = 0;

  for (const edit of edits) {
    chunks.push(input.subarray(cursor, edit.byteRange.start));
    chunks.push(Buffer.from(edit.text, 'utf8'));
    cursor = edit.byteRange.end;
  }

  chunks.push(input.subarray(cursor));
  return Buffer.concat(chunks).toString('utf8');
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
  const editsByFile = new Map<string, PolicyWorkspaceEdit[]>();
  editsByFile.set(options.filePath, policyFixWorkspaceEditsGet(options.filePath, options.fix));

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

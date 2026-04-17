/**
 * Workspace edit normalization and application helpers shared across
 * core, workspace-service, and policy plugins.
 */

import { Err, Ok, type Result } from '../result/result';
import type { PolicyWorkspaceEdit } from './policyTypes';

/**
 * Sort, deduplicate, and (optionally) reject overlapping workspace edits for
 * a single file. Overlapping edits are silently dropped unless `rejectOverlaps`
 * is set, in which case an error result is returned instead.
 */
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

/**
 * Apply normalized workspace edits to a single source string. Edits must be
 * sorted by `byteRange.start` ascending and non-overlapping.
 */
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

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PolicyViolationFix } from '@codepol/core';
import { eslintFixFromTreeCheckFix } from './eslintTreeCheckFix';

describe('eslintFixFromTreeCheckFix', () => {
  const fileA = path.resolve('/proj/a.ts');
  const fileB = path.resolve('/proj/b.ts');

  it('applies single-file multi-range fix in reverse order', () => {
    const fix: PolicyViolationFix = {
      byteRange: { start: 0, end: 1 },
      text: 'x',
      edits: [
        { filePath: fileA, byteRange: { start: 0, end: 1 }, text: 'a' },
        { filePath: fileA, byteRange: { start: 10, end: 11 }, text: 'b' },
      ],
    };
    const f = eslintFixFromTreeCheckFix(fileA, fix);
    expect(f).toBeDefined();
  });

  it('returns undefined when edits span multiple files', () => {
    const fix: PolicyViolationFix = {
      byteRange: { start: 0, end: 1 },
      text: 'x',
      edits: [
        { filePath: fileA, byteRange: { start: 0, end: 1 }, text: 'a' },
        { filePath: fileB, byteRange: { start: 0, end: 1 }, text: 'b' },
      ],
    };
    expect(eslintFixFromTreeCheckFix(fileA, fix)).toBeUndefined();
  });

  it('returns undefined when edits target a different file than the ESLint file', () => {
    const fix: PolicyViolationFix = {
      byteRange: { start: 0, end: 1 },
      text: 'x',
      edits: [{ filePath: fileB, byteRange: { start: 0, end: 1 }, text: 'a' }],
    };
    expect(eslintFixFromTreeCheckFix(fileA, fix)).toBeUndefined();
  });

  it('uses primary range when edits are absent', () => {
    const fix: PolicyViolationFix = {
      byteRange: { start: 2, end: 5 },
      text: 'foo',
    };
    expect(eslintFixFromTreeCheckFix(fileA, fix)).toBeDefined();
  });
});

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TSESLint } from '@typescript-eslint/utils';
import type { PolicyViolationFix } from '@codepol/core';
import { eslintFixFromTreeCheckFix } from './eslintTreeCheckFix';

describe('eslintFixFromTreeCheckFix', () => {
  const fileA = path.resolve('/proj/a.ts');
  const fileB = path.resolve('/proj/b.ts');
  type CapturedFix = { range: [number, number]; text: string };

  function capturedFixNormalize(
    fix: { range: readonly number[]; text: string },
  ): CapturedFix {
    return {
      range: [fix.range[0]!, fix.range[1]!],
      text: fix.text,
    };
  }

  function capturedFixIs(
    value: unknown,
  ): value is { range: readonly number[]; text: string } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'range' in value &&
      'text' in value
    );
  }

  function fixesCollect(
    fix: NonNullable<ReturnType<typeof eslintFixFromTreeCheckFix>>,
  ): CapturedFix[] {
    const fixer = {
      replaceTextRange: (range: [number, number], text: string) => ({
        range,
        text,
      }),
    } as unknown as TSESLint.RuleFixer;
    const result = fix(fixer);
    if (!result) {
      return [];
    }
    if (Array.isArray(result)) {
      return result.map(capturedFixNormalize);
    }
    if (capturedFixIs(result)) {
      return [capturedFixNormalize(result)];
    }
    if (Symbol.iterator in Object(result)) {
      return Array.from(
        result as Iterable<{ range: readonly number[]; text: string }>,
      ).map(capturedFixNormalize);
    }
    return [];
  }

  it('applies normalized single-file multi-range fixes', () => {
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
    expect(fixesCollect(f!)).toEqual([
      { range: [0, 1], text: 'a' },
      { range: [10, 11], text: 'b' },
    ]);
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

  it('returns undefined when same-file edits overlap', () => {
    const fix: PolicyViolationFix = {
      byteRange: { start: 0, end: 1 },
      text: 'x',
      edits: [
        { filePath: fileA, byteRange: { start: 0, end: 10 }, text: 'first' },
        { filePath: fileA, byteRange: { start: 5, end: 12 }, text: 'second' },
      ],
    };
    expect(eslintFixFromTreeCheckFix(fileA, fix)).toBeUndefined();
  });

  it('dedupes identical same-file edits before creating an ESLint fix', () => {
    const fix: PolicyViolationFix = {
      byteRange: { start: 0, end: 1 },
      text: 'x',
      edits: [
        { filePath: fileA, byteRange: { start: 0, end: 1 }, text: 'a' },
        { filePath: fileA, byteRange: { start: 0, end: 1 }, text: 'a' },
      ],
    };
    const f = eslintFixFromTreeCheckFix(fileA, fix);
    expect(f).toBeDefined();
    expect(fixesCollect(f!)).toEqual([{ range: [0, 1], text: 'a' }]);
  });

  it('uses primary range when edits are absent', () => {
    const fix: PolicyViolationFix = {
      byteRange: { start: 2, end: 5 },
      text: 'foo',
    };
    expect(eslintFixFromTreeCheckFix(fileA, fix)).toBeDefined();
  });
});

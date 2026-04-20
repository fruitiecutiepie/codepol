import { describe, expect, it } from 'vitest';
import {
  dependencyGraphLineCountFromSource,
  workspaceFileLineCountGet,
} from './dependencyGraphLoc';

describe('dependencyGraphLineCountFromSource', () => {
  it('returns 0 for an empty source', () => {
    expect(dependencyGraphLineCountFromSource('')).toBe(0);
  });

  it('counts each newline-terminated line', () => {
    expect(dependencyGraphLineCountFromSource('a\nb\nc\n')).toBe(3);
  });

  it('counts a trailing partial line that lacks a terminating newline', () => {
    expect(dependencyGraphLineCountFromSource('a\nb\nc')).toBe(3);
  });

  it('counts a single non-empty line with no trailing newline as 1', () => {
    expect(dependencyGraphLineCountFromSource('hello')).toBe(1);
  });

  it('treats a string of only newlines as one line per newline', () => {
    expect(dependencyGraphLineCountFromSource('\n\n\n')).toBe(3);
  });
});

describe('workspaceFileLineCountGet', () => {
  it('returns the line count when sourceGet succeeds', () => {
    expect(
      workspaceFileLineCountGet(() => 'export const a = 1;\nexport const b = 2;\n'),
    ).toBe(2);
  });

  it('returns undefined when sourceGet throws', () => {
    // This is the only branch of `workspaceFileLineCountGet` that the
    // public service surface cannot exercise: file discovery via
    // `ruleMatchesGet` happens before the LOC pass, so a missing file
    // is dropped from `index.filesGet()` before the helper runs. The
    // catch only protects against an in-process TOCTOU between the
    // glob and the read — unit testing it via a thunk is the only
    // reliable way to lock the contract in.
    expect(
      workspaceFileLineCountGet(() => {
        throw new Error('ENOENT: no such file or directory');
      }),
    ).toBeUndefined();
  });

  it('swallows non-Error throws as well so the metrics block stays valid', () => {
    expect(
      workspaceFileLineCountGet(() => {
        // Some Node error shapes throw objects that are not Error
        // instances; the catch must still trigger.
        throw 'unreadable'; // eslint-disable-line no-throw-literal
      }),
    ).toBeUndefined();
  });
});

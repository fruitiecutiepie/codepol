/**
 * Pure-function tests for the cycle gutter decoration helpers.
 *
 * Phase 5 follow-up — covers `cycleMembershipLookupCreate` (membership
 * lookup) and `cycleHoverMarkdownCreate` (hover card rendering).
 */
import { describe, expect, it } from 'vitest';
import {
  cycleHoverMarkdownCreate,
  cycleMembershipLookupCreate,
} from '../extension-vscode/src/cycleGutterDecorationViewModels';

const URI_A = 'file:///workspace/src/a.ts';
const URI_B = 'file:///workspace/src/b.ts';
const URI_C = 'file:///workspace/src/c.ts';
const URI_D = 'file:///workspace/src/d.ts';

function relPathOf(uri: string): string {
  return uri.replace('file:///workspace/', '');
}

describe('cycleMembershipLookupCreate', () => {
  it('returns null for a URI that is not in any cycle', () => {
    const lookup = cycleMembershipLookupCreate([[URI_A, URI_B]]);
    expect(lookup.uriIsInCycle(URI_C)).toBeNull();
  });

  it('returns the cycle members for a URI that participates in a 2-cycle', () => {
    const lookup = cycleMembershipLookupCreate([[URI_A, URI_B]]);
    const result = lookup.uriIsInCycle(URI_A);
    expect(result).not.toBeNull();
    expect(result!.cycleMembers).toEqual([URI_A, URI_B]);
    // Members are sorted within the lookup so the order is
    // deterministic regardless of the input traversal order.
    expect(lookup.uriIsInCycle(URI_B)!.cycleMembers).toEqual([URI_A, URI_B]);
  });

  it('drops trivial size-1 cycles (those should never appear in a real graph)', () => {
    const lookup = cycleMembershipLookupCreate([[URI_A], [URI_B, URI_C]]);
    expect(lookup.uriIsInCycle(URI_A)).toBeNull();
    expect(lookup.uriIsInCycle(URI_B)?.cycleMembers).toEqual([URI_B, URI_C]);
  });

  it('chooses a deterministic cycle when a URI participates in multiple cycles', () => {
    // URI_A appears in both cycles. The lookup should return the
    // alphabetically-first cycle (by member-joined key) for any
    // run of the same input.
    const cyclesOrderA = [
      [URI_A, URI_C],
      [URI_A, URI_B],
    ];
    const cyclesOrderB = [
      [URI_A, URI_B],
      [URI_A, URI_C],
    ];
    const lookupA = cycleMembershipLookupCreate(cyclesOrderA);
    const lookupB = cycleMembershipLookupCreate(cyclesOrderB);
    expect(lookupA.uriIsInCycle(URI_A)!.cycleMembers).toEqual(
      lookupB.uriIsInCycle(URI_A)!.cycleMembers,
    );
    // Specifically, the [A, B] cycle wins because A < C.
    expect(lookupA.uriIsInCycle(URI_A)!.cycleMembers).toEqual([URI_A, URI_B]);
  });
});

describe('cycleHoverMarkdownCreate', () => {
  it('renders the focus file first, then the remaining members sorted, with a plural cycle-size header', () => {
    const md = cycleHoverMarkdownCreate({
      focusUri: URI_B,
      cycleMembers: [URI_A, URI_B, URI_D, URI_C],
      workspaceRelativePathOf: relPathOf,
      peekCommandId: 'codepol.architecture.peek',
    });
    const lines = md.split('\n');
    expect(lines[0]).toBe('**Codepol cycle (4 files)**');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe(
      `- [src/b.ts](command:codepol.architecture.peek?${encodeURIComponent(
        JSON.stringify({ uri: URI_B }),
      )})`,
    );
    expect(lines[3]).toBe(
      `- [src/a.ts](command:codepol.architecture.peek?${encodeURIComponent(
        JSON.stringify({ uri: URI_A }),
      )})`,
    );
    expect(lines[4]).toBe(
      `- [src/c.ts](command:codepol.architecture.peek?${encodeURIComponent(
        JSON.stringify({ uri: URI_C }),
      )})`,
    );
    expect(lines[5]).toBe(
      `- [src/d.ts](command:codepol.architecture.peek?${encodeURIComponent(
        JSON.stringify({ uri: URI_D }),
      )})`,
    );
  });

  it('emits plain bullet entries (no command link) when peekCommandId is absent', () => {
    const md = cycleHoverMarkdownCreate({
      focusUri: URI_A,
      cycleMembers: [URI_A, URI_B],
      workspaceRelativePathOf: relPathOf,
    });
    expect(md).toContain('- src/a.ts');
    expect(md).toContain('- src/b.ts');
    expect(md).not.toContain('command:');
  });

  it('does not duplicate the focus file when it appears in the cycleMembers input', () => {
    const md = cycleHoverMarkdownCreate({
      focusUri: URI_A,
      cycleMembers: [URI_A, URI_B],
      workspaceRelativePathOf: relPathOf,
    });
    const occurrences = md.split('src/a.ts').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does not duplicate the focus file when the cycleMembers omit it', () => {
    const md = cycleHoverMarkdownCreate({
      focusUri: URI_A,
      cycleMembers: [URI_B],
      workspaceRelativePathOf: relPathOf,
    });
    const occurrences = md.split('src/a.ts').length - 1;
    expect(occurrences).toBe(1);
  });
});

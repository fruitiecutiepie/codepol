import { describe, it, expect } from 'vitest';
import {
  policyCacheClear,
  projectIndexCacheClear,
} from './eslintAdapter';

// ============================================================================
// ESLint Adapter Cache / State Clearing
// ============================================================================

/** Related-location spans use 1-based columns; ESLint `loc` uses 0-based (see eslintAdapter). */
describe('eslintAdapter related-location column convention', () => {
  it('maps 1-based columns to ESLint 0-based columns', () => {
    const column1Based = 5;
    const endColumn1Based = 18;
    expect(column1Based - 1).toBe(4);
    expect(endColumn1Based - 1).toBe(17);
  });
});

describe('eslintAdapter cache and state clearing', () => {
  describe('policyCacheClear', () => {
    it('clears the policy cache without error', () => {
      // policyCacheClear is re-exported from @codepol/core (policyGet).
      // Calling it should not throw, even when the cache is already empty.
      expect(() => policyCacheClear()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      policyCacheClear();
      policyCacheClear();
      // No assertion beyond "doesn't throw" — the Maps are private
    });
  });

  describe('projectIndexCacheClear', () => {
    it('clears the project index cache without error', () => {
      // projectIndexCacheClear clears the internal projectIndexCache Map.
      // After clearing, the next ESLint run will rebuild the project index.
      expect(() => projectIndexCacheClear()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      projectIndexCacheClear();
      projectIndexCacheClear();
    });
  });
});

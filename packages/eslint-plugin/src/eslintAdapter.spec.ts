import { describe, it, expect } from 'vitest';
import {
  policyCacheClear,
  projectIndexCacheClear,
} from './eslintAdapter';

// ============================================================================
// ESLint Adapter Cache / State Clearing
// ============================================================================

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

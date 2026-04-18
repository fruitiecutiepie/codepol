import { describe, it, expect } from 'vitest';
import {
  biomeBridgeRule,
  eslintBridgeRule,
  ruffBridgeRule,
} from './externalBridgeRules';

describe('external bridge rules', () => {
  describe('eslintBridgeRule', () => {
    it('has id "eslint"', () => {
      expect(eslintBridgeRule.id).toBe('eslint');
    });

    it('declares exactly one eslint lint provider', () => {
      const providers = eslintBridgeRule.capabilities.lintProviders ?? [];
      expect(providers).toHaveLength(1);
      expect(providers[0].platform).toBe('eslint');
    });

    it('advertises JS/TS/JSX/TSX languages', () => {
      const provider = eslintBridgeRule.capabilities.lintProviders![0];
      expect(provider.languages).toEqual(['javascript', 'typescript', 'jsx', 'tsx']);
    });

    it('is trigger-only: no tree-check provider', () => {
      expect(eslintBridgeRule.capabilities.treeCheckProvider).toBeUndefined();
    });

    it('is trigger-only: eslint provider config has empty rules map', () => {
      const provider = eslintBridgeRule.capabilities.lintProviders![0];
      expect(provider.config).toEqual({ rules: {} });
    });
  });

  describe('biomeBridgeRule', () => {
    it('has id "biome"', () => {
      expect(biomeBridgeRule.id).toBe('biome');
    });

    it('declares exactly one biome lint provider', () => {
      const providers = biomeBridgeRule.capabilities.lintProviders ?? [];
      expect(providers).toHaveLength(1);
      expect(providers[0].platform).toBe('biome');
    });

    it('advertises JS/TS/JSX/TSX languages', () => {
      const provider = biomeBridgeRule.capabilities.lintProviders![0];
      expect(provider.languages).toEqual(['javascript', 'typescript', 'jsx', 'tsx']);
    });

    it('is trigger-only: no tree-check provider', () => {
      expect(biomeBridgeRule.capabilities.treeCheckProvider).toBeUndefined();
    });

    it('is trigger-only: empty provider config (args drive it)', () => {
      const provider = biomeBridgeRule.capabilities.lintProviders![0];
      expect(provider.config).toEqual({});
    });
  });

  describe('ruffBridgeRule', () => {
    it('has id "ruff"', () => {
      expect(ruffBridgeRule.id).toBe('ruff');
    });

    it('declares exactly one ruff lint provider', () => {
      const providers = ruffBridgeRule.capabilities.lintProviders ?? [];
      expect(providers).toHaveLength(1);
      expect(providers[0].platform).toBe('ruff');
    });

    it('advertises only python', () => {
      const provider = ruffBridgeRule.capabilities.lintProviders![0];
      expect(provider.languages).toEqual(['python']);
    });

    it('is trigger-only: no tree-check provider', () => {
      expect(ruffBridgeRule.capabilities.treeCheckProvider).toBeUndefined();
    });

    it('is trigger-only: empty provider config (args drive it)', () => {
      const provider = ruffBridgeRule.capabilities.lintProviders![0];
      expect(provider.config).toEqual({});
    });
  });
});

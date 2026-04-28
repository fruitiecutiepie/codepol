import { describe, it, expect, beforeAll, vi } from 'vitest';
import { isOk, isErr } from '../result/result';
import { langAdd } from './parserLangs';
import { parserInit, parserGetForFile, parserRuntimeIsReady } from './parserInit';

// Vitest isolates each file in its own worker, so parserInitialized starts as false
// and global Maps in parserLangs are empty.

describe('parserInit', () => {
  // Suppress console.error from parserGetForFile error paths
  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('before initialization', () => {
    it('should return Err when parserGetForFile is called before parserInit', () => {
      const result = parserGetForFile('example.ts');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.Err).toContain('Parser not initialized');
      }
    });
  });

  describe('after initialization', () => {
    beforeAll(async () => {
      langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
      await parserInit();
    });

    it('should initialize successfully and load registered languages', async () => {
      // parserInit completed without throwing — that's the assertion.
      // Calling again should be a no-op (idempotent).
      await expect(parserInit()).resolves.toBeUndefined();
      expect(parserRuntimeIsReady()).toBe(true);
    });

    it('should return Ok with a parser for a known file extension', () => {
      const result = parserGetForFile('example.ts');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // The parser should have a setLanguage-configured parser
        expect(result.Ok).toBeDefined();
        // Verify it can parse TypeScript
        const tree = result.Ok.parse('const x = 1;');
        expect(tree.rootNode.type).toBe('program');
      }
    });

    it('re-initializes safely after module reloads using shared language registrations', async () => {
      vi.resetModules();
      const reloaded = await import('./parserInit');
      await reloaded.parserInit();

      const result = reloaded.parserGetForFile('example.ts');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const tree = result.Ok.parse('const y = 2;');
        expect(tree.rootNode.type).toBe('program');
      }
    });

    it('should return Err for an unknown file extension', () => {
      const result = parserGetForFile('file.unknown');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.Err).toContain('No language registered');
        expect(result.Err).toContain('file.unknown');
      }
    });
  });
});

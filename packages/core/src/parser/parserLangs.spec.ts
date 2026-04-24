import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Language } from 'web-tree-sitter';
import {
  langAdd,
  langsGet,
  wasmPathGet,
  langSet,
  langExists,
  langGetForFile,
} from './parserLangs';

// Vitest isolates each file in its own worker, so global Maps start empty.

/** Minimal mock satisfying the Language type for lookup tests. */
const mockLanguage = {} as unknown as Language;
const mockLanguageAlt = { alt: true } as unknown as Language;

describe('parserLangs', () => {
  describe('wasmPathGet', () => {
    it('should return a resolved path ending with the grammar .wasm filename', () => {
      const result = wasmPathGet('tree-sitter-typescript');

      expect(result).toContain('tree-sitter-typescript.wasm');
      expect(result).toContain('wasm');
    });
  });

  describe('langAdd', () => {
    it('should register a language with normalized extensions', () => {
      langAdd({ langId: 'testlang-a', fileExtensions: ['ts', '.TSX'] });

      const langs = langsGet();
      const registered = langs.find(l => l.langId === 'testlang-a');

      expect(registered).toBeDefined();
      expect(registered!.fileExtensions).toContain('.ts');
      expect(registered!.fileExtensions).toContain('.tsx');
      // Extensions are lowercased and dot-prefixed
      expect(registered!.fileExtensions.every(e => e.startsWith('.'))).toBe(true);
      expect(registered!.fileExtensions.every(e => e === e.toLowerCase())).toBe(true);
    });

    it('should assign default wasmPath when not specified', () => {
      const langs = langsGet();
      const registered = langs.find(l => l.langId === 'testlang-a');

      expect(registered).toBeDefined();
      expect(registered!.wasmPath).toContain('tree-sitter-testlang-a.wasm');
    });

    it('should use custom wasmPath when specified', () => {
      langAdd({ langId: 'testlang-b', fileExtensions: ['.custom'], wasmPath: '/my/custom.wasm' });

      const registered = langsGet().find(l => l.langId === 'testlang-b');
      expect(registered).toBeDefined();
      expect(registered!.wasmPath).toBe('/my/custom.wasm');
    });

    it('should throw when langId is empty', () => {
      expect(() => langAdd({ langId: '', fileExtensions: ['.x'] })).toThrow(
        'non-empty langId'
      );
    });

    it('should throw when langId is whitespace-only', () => {
      expect(() => langAdd({ langId: '   ', fileExtensions: ['.x'] })).toThrow(
        'non-empty langId'
      );
    });

    it('should throw when fileExtensions is empty', () => {
      expect(() => langAdd({ langId: 'testlang-empty', fileExtensions: [] })).toThrow(
        'at least one file extension'
      );
    });

    it('should merge extensions when duplicate langId with same wasmPath', () => {
      const wasmPath = '/shared/path.wasm';
      langAdd({ langId: 'testlang-merge', fileExtensions: ['.ma'], wasmPath });
      langAdd({ langId: 'testlang-merge', fileExtensions: ['.mb'], wasmPath });

      const registered = langsGet().find(l => l.langId === 'testlang-merge');
      expect(registered).toBeDefined();
      expect(registered!.fileExtensions).toContain('.ma');
      expect(registered!.fileExtensions).toContain('.mb');
    });

    it('should merge when duplicate langId uses different path strings for the same file', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-lang-'));
      try {
        const realWasm = path.join(tmp, 'real.wasm');
        fs.writeFileSync(realWasm, '');
        const linkWasm = path.join(tmp, 'link.wasm');
        fs.symlinkSync(realWasm, linkWasm);
        langAdd({ langId: 'testlang-symlink', fileExtensions: ['.s1'], wasmPath: realWasm });
        langAdd({ langId: 'testlang-symlink', fileExtensions: ['.s2'], wasmPath: linkWasm });
        const registered = langsGet().find(l => l.langId === 'testlang-symlink');
        expect(registered).toBeDefined();
        expect(registered!.fileExtensions).toContain('.s1');
        expect(registered!.fileExtensions).toContain('.s2');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should merge when duplicate langId uses two paths with identical wasm bytes', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-lang-'));
      try {
        const wasmA = path.join(tmp, 'a.wasm');
        const wasmB = path.join(tmp, 'b.wasm');
        const bytes = Buffer.from('fake wasm payload');
        fs.writeFileSync(wasmA, bytes);
        fs.writeFileSync(wasmB, bytes);
        langAdd({ langId: 'testlang-dupbytes', fileExtensions: ['.u1'], wasmPath: wasmA });
        langAdd({ langId: 'testlang-dupbytes', fileExtensions: ['.u2'], wasmPath: wasmB });
        const registered = langsGet().find(l => l.langId === 'testlang-dupbytes');
        expect(registered).toBeDefined();
        expect(registered!.fileExtensions).toContain('.u1');
        expect(registered!.fileExtensions).toContain('.u2');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should throw when duplicate langId with different wasmPath', () => {
      langAdd({ langId: 'testlang-conflict', fileExtensions: ['.cc'], wasmPath: '/path/a.wasm' });

      expect(() =>
        langAdd({ langId: 'testlang-conflict', fileExtensions: ['.cd'], wasmPath: '/path/b.wasm' })
      ).toThrow('already registered with a different wasmPath');
    });

    it('should throw when extension is already claimed by a different language', () => {
      langAdd({ langId: 'testlang-ext1', fileExtensions: ['.shared'] });

      expect(() =>
        langAdd({ langId: 'testlang-ext2', fileExtensions: ['.shared'] })
      ).toThrow('already registered for language "testlang-ext1"');
    });
  });

  describe('langsGet', () => {
    it('should return all registered languages', () => {
      const langs = langsGet();

      // From the tests above, we've registered several languages
      const ids = langs.map(l => l.langId);
      expect(ids).toContain('testlang-a');
      expect(ids).toContain('testlang-b');
      expect(ids).toContain('testlang-merge');
      expect(ids).toContain('testlang-symlink');
      expect(ids).toContain('testlang-dupbytes');
    });
  });

  describe('langExists', () => {
    it('should return false when language has not been set', () => {
      expect(langExists('nonexistent-lang')).toBe(false);
    });

    it('should return true after langSet', () => {
      langSet('testlang-exists', mockLanguage);

      expect(langExists('testlang-exists')).toBe(true);
    });
  });

  describe('langGetForFile', () => {
    it('should return Language for a known extension after langAdd + langSet', () => {
      // testlang-a was registered with .ts and .tsx extensions
      langSet('testlang-a', mockLanguage);

      const result = langGetForFile('example.ts');

      expect(result).toBe(mockLanguage);
    });

    it('should return null for an unknown extension', () => {
      const result = langGetForFile('file.unknown');

      expect(result).toBeNull();
    });

    it('should return null for a file with no extension', () => {
      const result = langGetForFile('Makefile');

      expect(result).toBeNull();
    });

    it('should match extensions case-insensitively', () => {
      // testlang-a was registered with .ts (normalized from 'ts')
      const result = langGetForFile('Example.TS');

      // path.extname returns '.TS', which is lowercased to '.ts' in langGetForFile
      expect(result).toBe(mockLanguage);
    });

    it('should return null when extension is registered but Language not yet set', () => {
      // testlang-ext1 was registered with .shared but langSet was never called for it
      const result = langGetForFile('file.shared');

      expect(result).toBeNull();
    });
  });
});

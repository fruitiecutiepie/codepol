import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isRelativeImport,
  isExternalPackage,
  moduleResolve,
  DEFAULT_EXTENSIONS,
} from './moduleResolver';

describe('moduleResolver', () => {
  let testDir: string;
  let srcDir: string;
  let fromFile: string;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-test-resolver-'));
    srcDir = path.join(testDir, 'src');

    // Build directory tree:
    //   src/
    //     utils.ts
    //     helpers/
    //       index.ts
    //     component.tsx
    //     legacy.js
    //   fromFile.ts
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(path.join(srcDir, 'helpers'), { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'utils.ts'), '');
    fs.writeFileSync(path.join(srcDir, 'helpers', 'index.ts'), '');
    fs.writeFileSync(path.join(srcDir, 'component.tsx'), '');
    fs.writeFileSync(path.join(srcDir, 'legacy.js'), '');

    fromFile = path.join(srcDir, 'fromFile.ts');
    fs.writeFileSync(fromFile, '');
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('isRelativeImport', () => {
    it('should return true for ./ and ../ prefixes and false for bare specifiers and absolute paths', () => {
      expect(isRelativeImport('./foo')).toBe(true);
      expect(isRelativeImport('../bar')).toBe(true);
      expect(isRelativeImport('lodash')).toBe(false);
      expect(isRelativeImport('/absolute/path')).toBe(false);
    });
  });

  describe('isExternalPackage', () => {
    it('should return true for bare and scoped packages, false for relative and absolute paths', () => {
      expect(isExternalPackage('lodash')).toBe(true);
      expect(isExternalPackage('@org/pkg')).toBe(true);
      expect(isExternalPackage('./foo')).toBe(false);
      expect(isExternalPackage('../bar')).toBe(false);
      expect(isExternalPackage('/absolute/path')).toBe(false);
    });
  });

  describe('moduleResolve', () => {
    const resolveOpts = () => ({
      baseDir: testDir,
      extensions: DEFAULT_EXTENSIONS,
    });

    it('should resolve a relative import without extension', () => {
      const resolved = moduleResolve('./utils', fromFile, resolveOpts());

      expect(resolved).toBe(path.join(srcDir, 'utils.ts'));
    });

    it('should resolve a relative import with explicit .ts extension', () => {
      const resolved = moduleResolve('./utils.ts', fromFile, resolveOpts());

      expect(resolved).toBe(path.join(srcDir, 'utils.ts'));
    });

    it('should resolve a directory with index.ts', () => {
      const resolved = moduleResolve('./helpers', fromFile, resolveOpts());

      expect(resolved).toBe(path.join(srcDir, 'helpers', 'index.ts'));
    });

    it('should return undefined for alias specifiers caught by isExternalPackage', () => {
      // Path alias specifiers like @/foo or ~/foo are treated as external
      // packages by isExternalPackage, so moduleResolve returns undefined
      // before the alias resolution logic is reached.
      const opts = {
        ...resolveOpts(),
        pathAliases: { '~/*': ['src/*'] },
      };

      const resolved = moduleResolve('~/utils', fromFile, opts);

      expect(resolved).toBeUndefined();
      expect(isExternalPackage('~/utils')).toBe(true);
    });

    it('should resolve .tsx and .js extensions', () => {
      const resolvedTsx = moduleResolve('./component', fromFile, resolveOpts());
      const resolvedJs = moduleResolve('./legacy', fromFile, resolveOpts());

      expect(resolvedTsx).toBe(path.join(srcDir, 'component.tsx'));
      expect(resolvedJs).toBe(path.join(srcDir, 'legacy.js'));
    });

    it('should return undefined for a non-existent file', () => {
      const resolved = moduleResolve('./does-not-exist', fromFile, resolveOpts());

      expect(resolved).toBeUndefined();
    });

    it('should return undefined for an external package', () => {
      const resolved = moduleResolve('lodash', fromFile, resolveOpts());

      expect(resolved).toBeUndefined();
    });

    describe('workspacePackages option', () => {
      it('should resolve a known workspace package to its entry file', () => {
        const entryFile = path.join(srcDir, 'utils.ts');
        const opts = {
          ...resolveOpts(),
          workspacePackages: new Map([['@org/utils', entryFile]]),
        };

        const resolved = moduleResolve('@org/utils', fromFile, opts);

        expect(resolved).toBe(entryFile);
      });

      it('should return undefined for unknown packages even with workspacePackages set', () => {
        const opts = {
          ...resolveOpts(),
          workspacePackages: new Map([['@org/utils', '/some/path.ts']]),
        };

        const resolved = moduleResolve('lodash', fromFile, opts);

        expect(resolved).toBeUndefined();
      });

      it('should resolve scoped packages that isExternalPackage would normally reject', () => {
        const entryFile = path.join(srcDir, 'helpers', 'index.ts');
        const opts = {
          ...resolveOpts(),
          workspacePackages: new Map([['@codepol/core', entryFile]]),
        };

        // Without workspacePackages, @codepol/core would be treated as external
        expect(isExternalPackage('@codepol/core')).toBe(true);

        // With workspacePackages, it resolves
        const resolved = moduleResolve('@codepol/core', fromFile, opts);

        expect(resolved).toBe(entryFile);
      });
    });
  });
});

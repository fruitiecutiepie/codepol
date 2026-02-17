import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspacePackageMapDiscover } from './workspacePackages';

describe('workspacePackageMapDiscover', () => {
  let rootDir: string;

  beforeAll(() => {
    rootDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codepol-ws-pkg-test-'),
    );
  });

  afterAll(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  /** Create a minimal workspace inside rootDir and return its path. */
  function wsDir(name: string): string {
    const dir = path.join(rootDir, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function writePkg(
    dir: string,
    relativePath: string,
    content: Record<string, unknown>,
  ): void {
    const full = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(content));
  }

  function writeFile(dir: string, relativePath: string, content = ''): string {
    const full = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }

  // ===========================================================================
  // Workspace pattern discovery
  // ===========================================================================

  describe('pnpm-workspace.yaml discovery', () => {
    it('parses standard packages section with quoted and unquoted patterns', () => {
      const ws = wsDir('pnpm-basic');
      fs.writeFileSync(
        path.join(ws, 'pnpm-workspace.yaml'),
        "packages:\n  - 'packages/*'\n  - apps/*\n",
      );
      writePkg(ws, 'packages/core/package.json', {
        name: '@test/core',
        main: './dist/index.js',
      });
      writeFile(ws, 'packages/core/src/index.ts');
      writePkg(ws, 'apps/cli/package.json', {
        name: '@test/cli',
        main: './dist/index.js',
      });
      writeFile(ws, 'apps/cli/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(2);
      expect(map.get('@test/core')).toBe(
        path.join(ws, 'packages/core/src/index.ts'),
      );
      expect(map.get('@test/cli')).toBe(
        path.join(ws, 'apps/cli/src/index.ts'),
      );
    });

    it('ignores comment lines between entries', () => {
      const ws = wsDir('pnpm-comments');
      fs.writeFileSync(
        path.join(ws, 'pnpm-workspace.yaml'),
        "packages:\n  - 'packages/*'\n  # this is a comment\n  - 'libs/*'\n",
      );
      writePkg(ws, 'packages/a/package.json', { name: '@c/a', main: './dist/index.js' });
      writeFile(ws, 'packages/a/src/index.ts');
      writePkg(ws, 'libs/b/package.json', { name: '@c/b', main: './dist/index.js' });
      writeFile(ws, 'libs/b/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(2);
      expect(map.has('@c/a')).toBe(true);
      expect(map.has('@c/b')).toBe(true);
    });

    it('stops parsing after packages section ends', () => {
      const ws = wsDir('pnpm-multi-section');
      fs.writeFileSync(
        path.join(ws, 'pnpm-workspace.yaml'),
        [
          'packages:',
          "  - 'packages/*'",
          '',
          'onlyBuiltDependencies:',
          '  - esbuild',
        ].join('\n'),
      );
      writePkg(ws, 'packages/x/package.json', { name: '@t/x', main: './dist/index.js' });
      writeFile(ws, 'packages/x/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(1);
      expect(map.has('@t/x')).toBe(true);
    });
  });

  describe('package.json workspaces discovery', () => {
    it('reads npm/yarn workspaces array', () => {
      const ws = wsDir('npm-ws');
      writePkg(ws, 'package.json', { workspaces: ['packages/*'] });
      writePkg(ws, 'packages/foo/package.json', {
        name: '@t/foo',
        main: './dist/index.js',
      });
      writeFile(ws, 'packages/foo/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(1);
      expect(map.get('@t/foo')).toBe(
        path.join(ws, 'packages/foo/src/index.ts'),
      );
    });

    it('reads yarn classic workspaces.packages format', () => {
      const ws = wsDir('yarn-ws');
      writePkg(ws, 'package.json', {
        workspaces: { packages: ['packages/*'] },
      });
      writePkg(ws, 'packages/bar/package.json', {
        name: '@t/bar',
        main: './dist/index.js',
      });
      writeFile(ws, 'packages/bar/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(1);
      expect(map.has('@t/bar')).toBe(true);
    });
  });

  describe('precedence', () => {
    it('pnpm-workspace.yaml takes precedence over package.json workspaces', () => {
      const ws = wsDir('both-present');
      fs.writeFileSync(
        path.join(ws, 'pnpm-workspace.yaml'),
        "packages:\n  - 'packages/*'\n",
      );
      // package.json points to a different pattern — should be ignored
      writePkg(ws, 'package.json', { workspaces: ['libs/*'] });
      writePkg(ws, 'packages/p/package.json', { name: '@both/p', main: './dist/index.js' });
      writeFile(ws, 'packages/p/src/index.ts');
      writePkg(ws, 'libs/l/package.json', { name: '@both/l', main: './dist/index.js' });
      writeFile(ws, 'libs/l/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.has('@both/p')).toBe(true);
      expect(map.has('@both/l')).toBe(false);
    });

    it('returns empty map when neither file is present', () => {
      const ws = wsDir('no-ws-config');
      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(0);
    });
  });

  // ===========================================================================
  // Entry-point resolution
  // ===========================================================================

  describe('entry-point resolution', () => {
    it('resolves exports["."] as string', () => {
      const ws = wsDir('exp-string');
      writePkg(ws, 'package.json', { workspaces: ['pkg'] });
      writePkg(ws, 'pkg/package.json', {
        name: '@e/str',
        exports: { '.': './dist/index.js' },
      });
      writeFile(ws, 'pkg/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.get('@e/str')).toBe(path.join(ws, 'pkg/src/index.ts'));
    });

    it('resolves exports["."] as object, preferring import field', () => {
      const ws = wsDir('exp-obj');
      writePkg(ws, 'package.json', { workspaces: ['pkg'] });
      writePkg(ws, 'pkg/package.json', {
        name: '@e/obj',
        exports: {
          '.': {
            import: './dist/index.js',
            require: './dist/index.cjs',
          },
        },
      });
      writeFile(ws, 'pkg/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.get('@e/obj')).toBe(path.join(ws, 'pkg/src/index.ts'));
    });

    it('falls back to main field when no exports', () => {
      const ws = wsDir('main-field');
      writePkg(ws, 'package.json', { workspaces: ['pkg'] });
      writePkg(ws, 'pkg/package.json', {
        name: '@e/main',
        main: './dist/index.js',
      });
      writeFile(ws, 'pkg/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.get('@e/main')).toBe(path.join(ws, 'pkg/src/index.ts'));
    });

    it('falls back to types field (.d.ts → .ts)', () => {
      const ws = wsDir('types-field');
      writePkg(ws, 'package.json', { workspaces: ['pkg'] });
      writePkg(ws, 'pkg/package.json', {
        name: '@e/types',
        types: './dist/index.d.ts',
      });
      writeFile(ws, 'pkg/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.get('@e/types')).toBe(path.join(ws, 'pkg/src/index.ts'));
    });

    it('resolves .mjs and .cjs extensions', () => {
      const ws = wsDir('ext-mjs');
      writePkg(ws, 'package.json', { workspaces: ['a', 'b'] });
      writePkg(ws, 'a/package.json', {
        name: '@e/mjs',
        main: './dist/index.mjs',
      });
      writeFile(ws, 'a/src/index.ts');
      writePkg(ws, 'b/package.json', {
        name: '@e/cjs',
        main: './dist/index.cjs',
      });
      writeFile(ws, 'b/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.get('@e/mjs')).toBe(path.join(ws, 'a/src/index.ts'));
      expect(map.get('@e/cjs')).toBe(path.join(ws, 'b/src/index.ts'));
    });

    it('uses src/index.ts fallback when dist mapping does not exist', () => {
      const ws = wsDir('fallback');
      writePkg(ws, 'package.json', { workspaces: ['pkg'] });
      // main points to a file whose src equivalent does NOT exist
      writePkg(ws, 'pkg/package.json', {
        name: '@e/fb',
        main: './dist/custom-entry.js',
      });
      // But src/index.ts does exist
      writeFile(ws, 'pkg/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.get('@e/fb')).toBe(path.join(ws, 'pkg/src/index.ts'));
    });

    it('skips packages with no resolvable entry', () => {
      const ws = wsDir('no-entry');
      writePkg(ws, 'package.json', { workspaces: ['pkg'] });
      // No exports, no main, no types, no src/index.ts
      writePkg(ws, 'pkg/package.json', { name: '@e/none' });

      const map = workspacePackageMapDiscover(ws);

      expect(map.has('@e/none')).toBe(false);
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('skips packages without a name field', () => {
      const ws = wsDir('no-name');
      writePkg(ws, 'package.json', { workspaces: ['pkg'] });
      writePkg(ws, 'pkg/package.json', { main: './dist/index.js' });
      writeFile(ws, 'pkg/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(0);
    });

    it('skips malformed package.json gracefully', () => {
      const ws = wsDir('malformed');
      writePkg(ws, 'package.json', { workspaces: ['pkg'] });
      // Write invalid JSON
      const pkgPath = path.join(ws, 'pkg', 'package.json');
      fs.mkdirSync(path.dirname(pkgPath), { recursive: true });
      fs.writeFileSync(pkgPath, '{ not valid json !!!');

      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(0);
    });

    it('discovers multiple packages across patterns', () => {
      const ws = wsDir('multi-pkg');
      writePkg(ws, 'package.json', {
        workspaces: ['packages/*', 'apps/*'],
      });
      writePkg(ws, 'packages/a/package.json', {
        name: '@m/a',
        main: './dist/index.js',
      });
      writeFile(ws, 'packages/a/src/index.ts');
      writePkg(ws, 'packages/b/package.json', {
        name: '@m/b',
        main: './dist/index.js',
      });
      writeFile(ws, 'packages/b/src/index.ts');
      writePkg(ws, 'apps/cli/package.json', {
        name: '@m/cli',
        main: './dist/index.js',
      });
      writeFile(ws, 'apps/cli/src/index.ts');

      const map = workspacePackageMapDiscover(ws);

      expect(map.size).toBe(3);
      expect(map.has('@m/a')).toBe(true);
      expect(map.has('@m/b')).toBe(true);
      expect(map.has('@m/cli')).toBe(true);
    });
  });
});

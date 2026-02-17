import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unusedExportsFix } from './unusedExportsFix';

describe('unusedExportsFix', () => {
  let rootDir: string;

  beforeAll(() => {
    rootDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codepol-fix-test-'),
    );
  });

  afterAll(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function wsDir(name: string): string {
    const dir = path.join(rootDir, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function writeFile(dir: string, rel: string, content: string): string {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }

  describe('workspace package resolution', () => {
    it('should keep exports imported via package name when cwd is provided', () => {
      // Workspace structure:
      //   ws/package.json              (workspaces: ["packages/*"])
      //   ws/packages/lib/package.json (name: "@fix/lib", main: "./dist/index.js")
      //   ws/packages/lib/src/index.ts (exports usedFn and unusedFn)
      //   ws/packages/app/src/main.ts  (imports usedFn from "@fix/lib")
      const ws = wsDir('ws-fix-test');
      writeFile(ws, 'package.json', JSON.stringify({ workspaces: ['packages/*'] }));
      writeFile(
        ws,
        'packages/lib/package.json',
        JSON.stringify({ name: '@fix/lib', main: './dist/index.js' }),
      );

      const libFile = writeFile(
        ws,
        'packages/lib/src/index.ts',
        [
          'export function usedFn() { return 1; }',
          'export function unusedFn() { return 2; }',
        ].join('\n'),
      );

      const appFile = writeFile(
        ws,
        'packages/app/src/main.ts',
        "import { usedFn } from '@fix/lib';\nusedFn();",
      );

      const files = [
        { filePath: libFile, source: fs.readFileSync(libFile, 'utf8') },
        { filePath: appFile, source: fs.readFileSync(appFile, 'utf8') },
      ];

      const fixes = unusedExportsFix(files, ws);

      // libFile should be fixed: unusedFn loses `export`, usedFn keeps it
      expect(fixes.has(libFile)).toBe(true);
      const fixed = fixes.get(libFile)!;
      expect(fixed).toContain('export function usedFn');
      expect(fixed).not.toContain('export function unusedFn');
      expect(fixed).toContain('function unusedFn');
    });

    it('should strip all exports when no cwd is provided and imports are via package name', () => {
      const ws = wsDir('ws-no-cwd');
      writeFile(ws, 'package.json', JSON.stringify({ workspaces: ['packages/*'] }));
      writeFile(
        ws,
        'packages/lib/package.json',
        JSON.stringify({ name: '@nc/lib', main: './dist/index.js' }),
      );

      const libFile = writeFile(
        ws,
        'packages/lib/src/index.ts',
        'export function onlyFn() { return 1; }',
      );

      const appFile = writeFile(
        ws,
        'packages/app/src/main.ts',
        "import { onlyFn } from '@nc/lib';\nonlyFn();",
      );

      const files = [
        { filePath: libFile, source: fs.readFileSync(libFile, 'utf8') },
        { filePath: appFile, source: fs.readFileSync(appFile, 'utf8') },
      ];

      // Without cwd, package-name imports can't be resolved
      const fixes = unusedExportsFix(files);

      // onlyFn should be flagged as unused since @nc/lib can't be resolved
      expect(fixes.has(libFile)).toBe(true);
      expect(fixes.get(libFile)).not.toContain('export function onlyFn');
    });

    it('should keep exports imported via relative path regardless of cwd', () => {
      const ws = wsDir('ws-relative');

      const libFile = writeFile(
        ws,
        'src/lib.ts',
        'export function relFn() { return 1; }',
      );

      const consumerFile = writeFile(
        ws,
        'src/consumer.ts',
        "import { relFn } from './lib';\nrelFn();",
      );

      const files = [
        { filePath: libFile, source: fs.readFileSync(libFile, 'utf8') },
        { filePath: consumerFile, source: fs.readFileSync(consumerFile, 'utf8') },
      ];

      const fixes = unusedExportsFix(files);

      // relFn is imported via relative path — no fix needed
      expect(fixes.has(libFile)).toBe(false);
    });
  });
});

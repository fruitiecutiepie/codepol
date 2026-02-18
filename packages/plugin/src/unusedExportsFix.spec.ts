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

  describe('re-export handling', () => {
    it('should never modify barrel re-export statements', () => {
      const ws = wsDir('ws-reexport-barrel');

      const implFile = writeFile(
        ws,
        'src/impl.ts',
        'export function barrelFn() { return 1; }\nexport type BarrelType = string;',
      );

      const barrelSource = "export { barrelFn } from './impl';\nexport type { BarrelType } from './impl';";
      const barrelFile = writeFile(ws, 'src/index.ts', barrelSource);

      const files = [
        { filePath: implFile, source: fs.readFileSync(implFile, 'utf8') },
        { filePath: barrelFile, source: fs.readFileSync(barrelFile, 'utf8') },
      ];

      const fixes = unusedExportsFix(files);

      // Barrel file must not be modified — removing `export` from
      // re-export statements produces invalid syntax.
      expect(fixes.has(barrelFile)).toBe(false);
    });

    it('should keep exports that are re-exported by a barrel file', () => {
      const ws = wsDir('ws-reexport-keeps');

      const implFile = writeFile(
        ws,
        'src/impl.ts',
        'export function usedViaBarrel() { return 1; }\nexport function notReexported() { return 2; }',
      );

      const barrelFile = writeFile(
        ws,
        'src/index.ts',
        "export { usedViaBarrel } from './impl';",
      );

      const files = [
        { filePath: implFile, source: fs.readFileSync(implFile, 'utf8') },
        { filePath: barrelFile, source: fs.readFileSync(barrelFile, 'utf8') },
      ];

      const fixes = unusedExportsFix(files);

      expect(fixes.has(implFile)).toBe(true);
      const fixed = fixes.get(implFile)!;
      expect(fixed).toContain('export function usedViaBarrel');
      expect(fixed).not.toContain('export function notReexported');
      expect(fixed).toContain('function notReexported');
    });

    it('should keep exports that are re-exported with type keyword', () => {
      const ws = wsDir('ws-reexport-type');

      const typesFile = writeFile(
        ws,
        'src/types.ts',
        'export type UsedType = string;\nexport type UnusedType = number;',
      );

      const barrelFile = writeFile(
        ws,
        'src/index.ts',
        "export type { UsedType } from './types';",
      );

      const files = [
        { filePath: typesFile, source: fs.readFileSync(typesFile, 'utf8') },
        { filePath: barrelFile, source: fs.readFileSync(barrelFile, 'utf8') },
      ];

      const fixes = unusedExportsFix(files);

      expect(fixes.has(typesFile)).toBe(true);
      const fixed = fixes.get(typesFile)!;
      expect(fixed).toContain('export type UsedType');
      expect(fixed).not.toContain('export type UnusedType');
      expect(fixed).toContain('type UnusedType');
    });

    it('should track re-export with `as` rename as usage of the original name', () => {
      const ws = wsDir('ws-reexport-alias');

      const implFile = writeFile(
        ws,
        'src/impl.ts',
        'export function originalName() { return 1; }',
      );

      const barrelFile = writeFile(
        ws,
        'src/index.ts',
        "export { originalName as renamedName } from './impl';",
      );

      const files = [
        { filePath: implFile, source: fs.readFileSync(implFile, 'utf8') },
        { filePath: barrelFile, source: fs.readFileSync(barrelFile, 'utf8') },
      ];

      const fixes = unusedExportsFix(files);

      // originalName is re-exported (aliased) → its export must be kept
      expect(fixes.has(implFile)).toBe(false);
    });

    it('should preserve exports through a chained barrel re-export', () => {
      const ws = wsDir('ws-reexport-chain');

      const implFile = writeFile(
        ws,
        'src/impl.ts',
        'export function chainedFn() { return 1; }',
      );

      const innerBarrel = writeFile(
        ws,
        'src/inner/index.ts',
        "export { chainedFn } from '../impl';",
      );

      const outerBarrel = writeFile(
        ws,
        'src/index.ts',
        "export { chainedFn } from './inner';",
      );

      const files = [
        { filePath: implFile, source: fs.readFileSync(implFile, 'utf8') },
        { filePath: innerBarrel, source: fs.readFileSync(innerBarrel, 'utf8') },
        { filePath: outerBarrel, source: fs.readFileSync(outerBarrel, 'utf8') },
      ];

      const fixes = unusedExportsFix(files);

      // chainedFn is used at every hop — no file should be modified
      expect(fixes.has(implFile)).toBe(false);
      expect(fixes.has(innerBarrel)).toBe(false);
      expect(fixes.has(outerBarrel)).toBe(false);
    });

    it('should handle a file with both declarations and re-exports', () => {
      const ws = wsDir('ws-mixed-decl-reexport');

      const helperFile = writeFile(
        ws,
        'src/helper.ts',
        'export function helperFn() { return 1; }',
      );

      const mixedFile = writeFile(
        ws,
        'src/mixed.ts',
        [
          "export { helperFn } from './helper';",
          'export function localUsed() { return 2; }',
          'export function localUnused() { return 3; }',
        ].join('\n'),
      );

      const consumerFile = writeFile(
        ws,
        'src/consumer.ts',
        "import { localUsed } from './mixed';\nlocalUsed();",
      );

      const files = [
        { filePath: helperFile, source: fs.readFileSync(helperFile, 'utf8') },
        { filePath: mixedFile, source: fs.readFileSync(mixedFile, 'utf8') },
        { filePath: consumerFile, source: fs.readFileSync(consumerFile, 'utf8') },
      ];

      const fixes = unusedExportsFix(files);

      // Mixed file: re-export untouched, localUsed kept, localUnused stripped
      expect(fixes.has(mixedFile)).toBe(true);
      const fixed = fixes.get(mixedFile)!;
      expect(fixed).toContain("export { helperFn } from './helper'");
      expect(fixed).toContain('export function localUsed');
      expect(fixed).not.toContain('export function localUnused');
      expect(fixed).toContain('function localUnused');
    });

    it('should preserve export default declarations', () => {
      const ws = wsDir('ws-export-default');

      const implFile = writeFile(
        ws,
        'src/impl.ts',
        'export default function main() { return 1; }\nexport function unused() { return 2; }',
      );

      const files = [
        { filePath: implFile, source: fs.readFileSync(implFile, 'utf8') },
      ];

      const fixes = unusedExportsFix(files);

      expect(fixes.has(implFile)).toBe(true);
      const fixed = fixes.get(implFile)!;
      // export default must never be removed
      expect(fixed).toContain('export default function main');
      // unused named export gets stripped
      expect(fixed).not.toContain('export function unused');
      expect(fixed).toContain('function unused');
    });
  });
});

import { describe, expect, it, beforeAll } from 'vitest';
import {
  langAdd,
  moduleGraphFromProjectIndex,
  parserInit,
  projectIndexBuildSync,
  type ArchitectureCheckContext,
  type PolicyFile,
  type PolicyRule,
  type PolicyRuleTarget,
  type ProjectIndex,
} from '@codepol/core';
import {
  noCrossPackageInternalImportCheck,
  type NoCrossPackageInternalImportArgs,
} from './noCrossPackageInternalImportCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

/**
 * Build a fake monorepo workspace with packages `@t/a` and `@t/b`,
 * plus a TypeScript file in each. Returns the workspace root and a
 * map of friendly names to absolute paths so tests don't need to know
 * the temp directory layout.
 */
function workspaceFixtureCreate(files: Record<string, string>): {
  dir: string;
  paths: Record<string, string>;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-cross-pkg-'));

  fs.writeFileSync(
    path.join(dir, 'pnpm-workspace.yaml'),
    "packages:\n  - 'packages/*'\n",
    'utf8',
  );

  // Two minimal package manifests so workspacePackageRecordsDiscover
  // can resolve each package's source entry point to src/index.ts.
  fs.mkdirSync(path.join(dir, 'packages/a/src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages/b/src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'packages/a/package.json'),
    JSON.stringify({ name: '@t/a', main: './dist/index.js' }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'packages/b/package.json'),
    JSON.stringify({ name: '@t/b', main: './dist/index.js' }),
    'utf8',
  );

  const paths: Record<string, string> = {};
  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    paths[name] = filePath;
  }
  return { dir, paths };
}

function contextCreate(
  dir: string,
  index: ProjectIndex,
  ruleArgs: NoCrossPackageInternalImportArgs,
): { rule: PolicyRule; context: ArchitectureCheckContext } {
  const rule: PolicyRule = {
    ruleId: 'no-cross-package-internal-import',
    targets: ['ts'],
    args: ruleArgs,
  };
  return {
    rule,
    context: {
      cwd: dir,
      policy,
      projectIndex: index,
      moduleGraph: moduleGraphFromProjectIndex(index),
      ruleArgs,
    },
  };
}

describe('noCrossPackageInternalImportCheck', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('allows importing the public entry point of another package', () => {
    const { dir, paths } = workspaceFixtureCreate({
      'packages/a/src/index.ts':
        'import { b } from "../../b/src/index"; export const a = b;\n',
      'packages/b/src/index.ts': 'export const b = 1;\n',
    });
    const fileList = [paths['packages/a/src/index.ts']!, paths['packages/b/src/index.ts']!];
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {});
    expect(noCrossPackageInternalImportCheck(rule, context)).toEqual([]);
  });

  it('reports an import that reaches into another package internals', () => {
    const { dir, paths } = workspaceFixtureCreate({
      'packages/a/src/index.ts':
        'import { secret } from "../../b/src/internal"; export const a = secret;\n',
      'packages/b/src/index.ts': 'export const b = 1;\n',
      'packages/b/src/internal.ts': 'export const secret = 42;\n',
    });
    const fileList = [
      paths['packages/a/src/index.ts']!,
      paths['packages/b/src/index.ts']!,
      paths['packages/b/src/internal.ts']!,
    ];
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {});

    const violations = noCrossPackageInternalImportCheck(rule, context);
    expect(violations.length).toBe(1);
    const v = violations[0]!;
    expect(v.filePath).toBe(paths['packages/a/src/index.ts']);
    expect(v.message).toContain("Package '@t/a' imports an internal file of '@t/b'");
    expect(v.relatedLocations?.[0]?.filePath).toBe(paths['packages/b/src/index.ts']);
  });

  it('honours the `allow` glob for additional public surfaces', () => {
    const { dir, paths } = workspaceFixtureCreate({
      'packages/a/src/index.ts':
        'import { secret } from "../../b/src/internal"; export const a = secret;\n',
      'packages/b/src/index.ts': 'export const b = 1;\n',
      'packages/b/src/internal.ts': 'export const secret = 42;\n',
    });
    const fileList = [
      paths['packages/a/src/index.ts']!,
      paths['packages/b/src/index.ts']!,
      paths['packages/b/src/internal.ts']!,
    ];
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {
      allow: ['packages/b/src/internal.ts'],
    });
    expect(noCrossPackageInternalImportCheck(rule, context)).toEqual([]);
  });

  it('honours `ignorePackages` to exempt a package entirely', () => {
    const { dir, paths } = workspaceFixtureCreate({
      'packages/a/src/index.ts':
        'import { secret } from "../../b/src/internal"; export const a = secret;\n',
      'packages/b/src/index.ts': 'export const b = 1;\n',
      'packages/b/src/internal.ts': 'export const secret = 42;\n',
    });
    const fileList = [
      paths['packages/a/src/index.ts']!,
      paths['packages/b/src/index.ts']!,
      paths['packages/b/src/internal.ts']!,
    ];
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {
      ignorePackages: ['@t/b'],
    });
    expect(noCrossPackageInternalImportCheck(rule, context)).toEqual([]);
  });

  it('ignores edges entirely within a single package', () => {
    const { dir, paths } = workspaceFixtureCreate({
      'packages/a/src/index.ts':
        'import { helper } from "./helper"; export const a = helper;\n',
      'packages/a/src/helper.ts': 'export const helper = 1;\n',
      'packages/b/src/index.ts': 'export const b = 1;\n',
    });
    const fileList = [
      paths['packages/a/src/index.ts']!,
      paths['packages/a/src/helper.ts']!,
      paths['packages/b/src/index.ts']!,
    ];
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {});
    expect(noCrossPackageInternalImportCheck(rule, context)).toEqual([]);
  });
});

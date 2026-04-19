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
  entryPointAllowlistCheck,
  type EntryPointAllowlistArgs,
} from './entryPointAllowlistCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

function fixtureCreate(files: Record<string, string>): { dir: string; paths: Record<string, string> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-entry-allow-'));
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
  ruleArgs: EntryPointAllowlistArgs,
): { rule: PolicyRule; context: ArchitectureCheckContext } {
  const rule: PolicyRule = {
    ruleId: 'entry-point-allowlist',
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

describe('entryPointAllowlistCheck', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('passes when every entry point is declared', () => {
    const { dir, paths } = fixtureCreate({
      'src/index.ts': 'import { lib } from "./lib"; export const main = lib;',
      'src/lib.ts': 'export const lib = 1;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {
      entries: ['src/index.ts'],
    });
    expect(entryPointAllowlistCheck(rule, context)).toEqual([]);
  });

  it('reports an undeclared orphan file', () => {
    const { dir, paths } = fixtureCreate({
      'src/index.ts': 'import { lib } from "./lib"; export const main = lib;',
      'src/lib.ts': 'export const lib = 1;',
      'src/orphan.ts': 'export const orphan = 99;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {
      entries: ['src/index.ts'],
    });

    const violations = entryPointAllowlistCheck(rule, context);
    expect(violations.length).toBe(1);
    expect(violations[0]!.filePath).toBe(paths['src/orphan.ts']);
    expect(violations[0]!.message).toContain('not declared in the entry-point allowlist');
  });

  it('honours `ignore` to skip orphan test files', () => {
    const { dir, paths } = fixtureCreate({
      'src/index.ts': 'import { lib } from "./lib"; export const main = lib;',
      'src/lib.ts': 'export const lib = 1;',
      'src/lib.spec.ts': 'export const spec = 1;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {
      entries: ['src/index.ts'],
      ignore: ['**/*.spec.ts'],
    });
    expect(entryPointAllowlistCheck(rule, context)).toEqual([]);
  });

  it('treats every orphan as a violation when entries is empty', () => {
    const { dir, paths } = fixtureCreate({
      'a.ts': 'export const a = 1;',
      'b.ts': 'export const b = 2;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, { entries: [] });

    const violations = entryPointAllowlistCheck(rule, context);
    expect(violations.length).toBe(2);
  });
});

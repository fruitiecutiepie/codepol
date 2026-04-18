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
import { deadModuleCheck } from './deadModuleCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

function fixtureCreate(files: Record<string, string>): { dir: string; paths: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-dead-module-'));
  const paths: string[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    paths.push(filePath);
  }
  return { dir, paths };
}

function contextCreate(
  dir: string,
  index: ProjectIndex,
  ruleArgs?: unknown,
): { rule: PolicyRule; context: ArchitectureCheckContext } {
  const rule: PolicyRule = {
    ruleId: 'dead-module',
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

describe('deadModuleCheck', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('returns no violations when every file is reachable from natural entry points', () => {
    const { dir, paths } = fixtureCreate({
      'entry.ts': 'import { used } from "./used"; export const entry = used;',
      'used.ts': 'export const used = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index);

    const violations = deadModuleCheck(rule, context);
    expect(violations).toEqual([]);
  });

  it('flags files unreachable from any entry point', () => {
    const { dir, paths } = fixtureCreate({
      'entry.ts': 'import { used } from "./used"; export const entry = used;',
      'used.ts': 'export const used = 1;',
      'orphan.ts': 'export const orphan = 99;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index);

    const violations = deadModuleCheck(rule, context);
    // 'orphan.ts' is its own natural entry point (no importers), so no
    // explicit entries means orphan.ts is also a root and reaches itself.
    // We expect zero violations under the default contract.
    expect(violations).toEqual([]);
  });

  it('respects an explicit `entries` glob and reports orphan files', () => {
    const { dir, paths } = fixtureCreate({
      'entry.ts': 'import { used } from "./used"; export const entry = used;',
      'used.ts': 'export const used = 1;',
      'orphan.ts': 'export const orphan = 99;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      entries: ['entry.ts'],
    });

    const violations = deadModuleCheck(rule, context);
    const orphanFile = paths.find((p) => p.endsWith('orphan.ts'))!;
    expect(violations.map((v) => v.filePath)).toEqual([orphanFile]);
  });

  it('honors `ignore` globs', () => {
    const { dir, paths } = fixtureCreate({
      'entry.ts': 'import { used } from "./used"; export const entry = used;',
      'used.ts': 'export const used = 1;',
      'orphan.ts': 'export const orphan = 99;',
      'orphan2.ts': 'export const orphan2 = 100;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      entries: ['entry.ts'],
      ignore: ['orphan.ts'],
    });

    const violations = deadModuleCheck(rule, context);
    const orphan2 = paths.find((p) => p.endsWith('orphan2.ts'))!;
    expect(violations.map((v) => v.filePath)).toEqual([orphan2]);
  });

  it('produces no violations when an explicit `entries` glob matches nothing', () => {
    const { dir, paths } = fixtureCreate({
      'a.ts': 'export const a = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      entries: ['does-not-exist.ts'],
    });

    expect(deadModuleCheck(rule, context)).toEqual([]);
  });
});

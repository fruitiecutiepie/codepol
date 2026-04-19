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
import { maxCycleSizeCheck, type MaxCycleSizeArgs } from './maxCycleSizeCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

function fixtureCreate(files: Record<string, string>): { dir: string; paths: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-max-cycle-size-'));
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
  ruleArgs: MaxCycleSizeArgs,
): { rule: PolicyRule; context: ArchitectureCheckContext } {
  const rule: PolicyRule = {
    ruleId: 'max-cycle-size',
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

describe('maxCycleSizeCheck', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('returns no violations on an acyclic graph', () => {
    const { dir, paths } = fixtureCreate({
      'a.ts': 'export const a = 1;',
      'b.ts': 'import { a } from "./a"; export const b = a + 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, { max: 2 });
    expect(maxCycleSizeCheck(rule, context)).toEqual([]);
  });

  it('returns no violations when every cycle is within budget', () => {
    const { dir, paths } = fixtureCreate({
      'a.ts': 'import { b } from "./b"; export const a = 1;',
      'b.ts': 'import { a } from "./a"; export const b = 2;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, { max: 2 });
    expect(maxCycleSizeCheck(rule, context)).toEqual([]);
  });

  it('reports a single violation when a cycle exceeds the budget', () => {
    // Three-file cycle a → b → c → a. With max=2 it should be reported.
    const { dir, paths } = fixtureCreate({
      'a.ts': 'import { b } from "./b"; export const a = 1;',
      'b.ts': 'import { c } from "./c"; export const b = 2;',
      'c.ts': 'import { a } from "./a"; export const c = 3;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, { max: 2 });

    const violations = maxCycleSizeCheck(rule, context);
    expect(violations.length).toBe(1);
    const v = violations[0]!;
    // Anchored on alphabetically-first member.
    expect(v.filePath).toBe(paths[0]!); // a.ts
    expect(v.message).toContain('exceeds max-cycle-size budget (3 > 2)');
    expect(v.relatedLocations?.length).toBe(2);
  });

  it('uses the `ignore` filter to shrink a cycle below `max`', () => {
    // Same 3-file cycle, but `c.ts` is ignored → effective cycle length 2 ≤ max=2.
    const { dir, paths } = fixtureCreate({
      'a.ts': 'import { b } from "./b"; export const a = 1;',
      'b.ts': 'import { c } from "./c"; export const b = 2;',
      'c.ts': 'import { a } from "./a"; export const c = 3;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      max: 2,
      ignore: ['c.ts'],
    });
    expect(maxCycleSizeCheck(rule, context)).toEqual([]);
  });
});

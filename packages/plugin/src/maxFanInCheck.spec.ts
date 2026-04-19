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
import { maxFanInCheck, type MaxFanInArgs } from './maxFanInCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

function fixtureCreate(files: Record<string, string>): { dir: string; paths: Record<string, string> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-max-fan-in-'));
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
  ruleArgs: MaxFanInArgs,
): { rule: PolicyRule; context: ArchitectureCheckContext } {
  const rule: PolicyRule = {
    ruleId: 'max-fan-in',
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

describe('maxFanInCheck', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('returns no violations when every file is within budget', () => {
    const { dir, paths } = fixtureCreate({
      'hub.ts': 'export const hub = 1;',
      'a.ts': 'import { hub } from "./hub"; export const a = hub;',
      'b.ts': 'import { hub } from "./hub"; export const b = hub;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, { max: 5 });
    expect(maxFanInCheck(rule, context)).toEqual([]);
  });

  it('reports a single violation when a file has too many importers', () => {
    const { dir, paths } = fixtureCreate({
      'hub.ts': 'export const hub = 1;',
      'a.ts': 'import { hub } from "./hub"; export const a = hub;',
      'b.ts': 'import { hub } from "./hub"; export const b = hub;',
      'c.ts': 'import { hub } from "./hub"; export const c = hub;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, { max: 2 });

    const violations = maxFanInCheck(rule, context);
    expect(violations.length).toBe(1);
    const v = violations[0]!;
    expect(v.filePath).toBe(paths['hub.ts']);
    expect(v.message).toContain('3 importers');
    expect(v.message).toContain('exceeds max of 2');
    expect(v.relatedLocations?.length).toBe(3);
  });

  it('respects the `files` glob to scope the budget', () => {
    const { dir, paths } = fixtureCreate({
      'lib/hub.ts': 'export const hub = 1;',
      'app/util.ts': 'export const util = 1;',
      'app/a.ts': 'import { hub } from "../lib/hub"; import { util } from "./util"; export const a = hub + util;',
      'app/b.ts': 'import { hub } from "../lib/hub"; import { util } from "./util"; export const b = hub + util;',
      'app/c.ts': 'import { hub } from "../lib/hub"; import { util } from "./util"; export const c = hub + util;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    // Only enforce the budget on lib/** — app/util.ts has the same fan-in but is exempt.
    const { rule, context } = contextCreate(dir, index, {
      max: 2,
      files: ['lib/**/*.ts'],
    });

    const violations = maxFanInCheck(rule, context);
    expect(violations.length).toBe(1);
    expect(violations[0]!.filePath).toBe(paths['lib/hub.ts']);
  });

  it('honours `ignore` to skip an over-budget file', () => {
    const { dir, paths } = fixtureCreate({
      'hub.ts': 'export const hub = 1;',
      'a.ts': 'import { hub } from "./hub"; export const a = hub;',
      'b.ts': 'import { hub } from "./hub"; export const b = hub;',
      'c.ts': 'import { hub } from "./hub"; export const c = hub;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {
      max: 2,
      ignore: ['hub.ts'],
    });
    expect(maxFanInCheck(rule, context)).toEqual([]);
  });
});

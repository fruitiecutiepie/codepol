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
import { maxFanOutCheck, type MaxFanOutArgs } from './maxFanOutCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

function fixtureCreate(files: Record<string, string>): { dir: string; paths: Record<string, string> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-max-fan-out-'));
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
  ruleArgs: MaxFanOutArgs,
): { rule: PolicyRule; context: ArchitectureCheckContext } {
  const rule: PolicyRule = {
    ruleId: 'max-fan-out',
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

describe('maxFanOutCheck', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('returns no violations when every file is within budget', () => {
    const { dir, paths } = fixtureCreate({
      'a.ts': 'export const a = 1;',
      'b.ts': 'import { a } from "./a"; export const b = a;',
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, { max: 5 });
    expect(maxFanOutCheck(rule, context)).toEqual([]);
  });

  it('reports a single violation when a file has too many importees', () => {
    const { dir, paths } = fixtureCreate({
      'one.ts': 'export const one = 1;',
      'two.ts': 'export const two = 2;',
      'three.ts': 'export const three = 3;',
      'orchestrator.ts': [
        'import { one } from "./one";',
        'import { two } from "./two";',
        'import { three } from "./three";',
        'export const all = one + two + three;',
      ].join('\n'),
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, { max: 2 });

    const violations = maxFanOutCheck(rule, context);
    expect(violations.length).toBe(1);
    const v = violations[0]!;
    expect(v.filePath).toBe(paths['orchestrator.ts']);
    expect(v.message).toContain('3 importees');
    expect(v.relatedLocations?.length).toBe(3);
  });

  it('honours `files` glob to scope the budget', () => {
    const { dir, paths } = fixtureCreate({
      'one.ts': 'export const one = 1;',
      'two.ts': 'export const two = 2;',
      'three.ts': 'export const three = 3;',
      'lib/orchestrator.ts': [
        'import { one } from "../one";',
        'import { two } from "../two";',
        'import { three } from "../three";',
        'export const all = one + two + three;',
      ].join('\n'),
      'app/orchestrator.ts': [
        'import { one } from "../one";',
        'import { two } from "../two";',
        'import { three } from "../three";',
        'export const all = one + two + three;',
      ].join('\n'),
    });
    const fileList = Object.values(paths);
    const { index } = projectIndexBuildSync({ files: fileList, dir });
    const { rule, context } = contextCreate(dir, index, {
      max: 2,
      files: ['lib/**/*.ts'],
    });

    const violations = maxFanOutCheck(rule, context);
    expect(violations.length).toBe(1);
    expect(violations[0]!.filePath).toBe(paths['lib/orchestrator.ts']);
  });
});

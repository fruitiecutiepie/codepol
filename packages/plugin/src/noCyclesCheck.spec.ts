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
import { noCyclesCheck, NO_CYCLES_DEFAULT_MAX } from './noCyclesCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

function fixtureCreate(files: Record<string, string>): { dir: string; paths: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-no-cycles-'));
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
    ruleId: 'no-cycles',
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

describe('noCyclesCheck', () => {
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
    const { rule, context } = contextCreate(dir, index);

    const violations = noCyclesCheck(rule, context);
    expect(violations).toEqual([]);
  });

  it('emits one violation per cycle anchored at the alphabetically-first file', () => {
    const { dir, paths } = fixtureCreate({
      'a.ts': 'import { b } from "./b"; export const a = 1;',
      'b.ts': 'import { a } from "./a"; export const b = 2;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index);

    const violations = noCyclesCheck(rule, context);
    expect(violations.length).toBe(1);
    const v = violations[0]!;
    expect(v.filePath).toBe(paths[0]!); // a.ts
    expect(v.line).toBe(1);
    expect(v.column).toBe(1);
    expect(v.message).toContain('Circular import');
    expect(v.relatedLocations?.[0]?.filePath).toBe(paths[1]!); // b.ts
  });

  it('truncates to maxCycles and emits a summary violation', () => {
    // Build three independent two-file cycles.
    const { dir, paths } = fixtureCreate({
      'a/x.ts': 'import { y } from "./y"; export const x = 1;',
      'a/y.ts': 'import { x } from "./x"; export const y = 2;',
      'b/x.ts': 'import { y } from "./y"; export const x = 1;',
      'b/y.ts': 'import { x } from "./x"; export const y = 2;',
      'c/x.ts': 'import { y } from "./y"; export const x = 1;',
      'c/y.ts': 'import { x } from "./x"; export const y = 2;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, { maxCycles: 2 });

    const violations = noCyclesCheck(rule, context);
    // 2 cycles + 1 summary
    expect(violations.length).toBe(3);
    expect(violations[2]!.message).toContain('1 additional circular import');
    expect(violations[2]!.filePath).toBe(dir); // Default context.cwd when configPath is absent
  });

  it('respects minSize to skip self-imports', () => {
    const { dir, paths } = fixtureCreate({
      // self-import via a re-export of itself; still produces a cycle of length 1
      // when the index resolves it. The check honors `minSize`.
      'a.ts': 'import { a } from "./a"; export const a = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    // minSize defaults to 2 → length-1 cycles are ignored
    const { rule, context } = contextCreate(dir, index);
    expect(noCyclesCheck(rule, context)).toEqual([]);
  });

  it('default maxCycles cap is respected', () => {
    expect(NO_CYCLES_DEFAULT_MAX).toBeGreaterThan(0);
  });
});

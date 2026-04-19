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
import { noUndeclaredImplementerCheck } from './noUndeclaredImplementerCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

function fixtureCreate(files: Record<string, string>): {
  dir: string;
  paths: string[];
} {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codepol-no-undeclared-impl-'),
  );
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
    ruleId: 'no-undeclared-implementer',
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

describe('noUndeclaredImplementerCheck', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('emits a violation for a class that satisfies an interface only by shape', () => {
    const { dir, paths } = fixtureCreate({
      'iface.ts': `
export interface IShape {
  area(): number;
  name: string;
}
`,
      'duck.ts': `
export class Duck {
  name = '';
  area(): number { return 1; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index);

    const violations = noUndeclaredImplementerCheck(rule, context);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('Duck');
    expect(violations[0].message).toContain('IShape');
    expect(violations[0].message).toContain('shape only');
    expect(violations[0].filePath).toContain('duck.ts');
    expect(violations[0].relatedLocations?.[0]?.filePath).toContain('iface.ts');
  });

  it('emits no violation when the class declares `implements`', () => {
    const { dir, paths } = fixtureCreate({
      'iface.ts': `
export interface IShape {
  area(): number;
}
`,
      'declared.ts': `
import { IShape } from './iface';
export class Triangle implements IShape {
  area(): number { return 1; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index);

    const violations = noUndeclaredImplementerCheck(rule, context);
    expect(violations).toEqual([]);
  });

  it('honors the `ignoreImplementers` glob', () => {
    const { dir, paths } = fixtureCreate({
      'iface.ts': `
export interface IShape {
  area(): number;
}
`,
      'duck-mock.ts': `
export class DuckMock {
  area(): number { return 0; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      ignoreImplementers: ['*Mock'],
    });

    const violations = noUndeclaredImplementerCheck(rule, context);
    expect(violations).toEqual([]);
  });

  it('honors the `interfaces` glob and skips non-matching interface names', () => {
    const { dir, paths } = fixtureCreate({
      'iface.ts': `
export interface InternalThing {
  doStuff(): void;
}
export interface IPublicShape {
  area(): number;
}
`,
      'impl.ts': `
export class Internal {
  doStuff(): void {}
}
export class Public {
  area(): number { return 1; }
}
`,
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      // Only flag interfaces whose name starts with `I` and ends with
      // `Shape` — InternalThing is excluded.
      interfaces: ['I*Shape'],
    });

    const violations = noUndeclaredImplementerCheck(rule, context);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('Public');
    expect(violations[0].message).toContain('IPublicShape');
  });

  it('reports multiple implementers per interface', () => {
    const { dir, paths } = fixtureCreate({
      'iface.ts': `
export interface ICallable {
  run(): void;
}
`,
      'a.ts': `
export class RunnerA {
  run(): void {}
}
`,
      'b.ts': `
export class RunnerB {
  run(): void {}
}
`,
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index);

    const violations = noUndeclaredImplementerCheck(rule, context);
    expect(violations).toHaveLength(2);
    const names = violations.map((v) => v.message).sort();
    expect(names.some((m) => m.includes('RunnerA'))).toBe(true);
    expect(names.some((m) => m.includes('RunnerB'))).toBe(true);
  });
});

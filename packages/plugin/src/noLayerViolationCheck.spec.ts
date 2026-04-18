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
  noLayerViolationCheck,
  type NoLayerViolationArgs,
} from './noLayerViolationCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tsTarget: PolicyRuleTarget = { language: 'typescript', files: ['**/*.ts'] };
const policy: PolicyFile = { targets: { ts: tsTarget }, rules: [] };

function fixtureCreate(files: Record<string, string>): { dir: string; paths: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-no-layer-'));
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
  ruleArgs: NoLayerViolationArgs,
): { rule: PolicyRule; context: ArchitectureCheckContext } {
  const rule: PolicyRule = {
    ruleId: 'no-layer-violation',
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

describe('noLayerViolationCheck', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('emits no violations when no layers are configured', () => {
    const { dir, paths } = fixtureCreate({
      'src/ui/page.ts': 'import { domain } from "../domain/model"; export const page = domain;',
      'src/domain/model.ts': 'export const domain = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {});
    expect(noLayerViolationCheck(rule, context)).toEqual([]);
  });

  it('flags an edge that violates the allows whitelist', () => {
    const { dir, paths } = fixtureCreate({
      'src/domain/model.ts': 'import { db } from "../infra/db"; export const m = db;',
      'src/infra/db.ts': 'export const db = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      layers: {
        domain: { files: ['src/domain/**/*.ts'], allows: [] },
        infra: { files: ['src/infra/**/*.ts'] },
      },
    });

    const violations = noLayerViolationCheck(rule, context);
    expect(violations.length).toBe(1);
    const v = violations[0]!;
    expect(v.filePath).toBe(paths[0]!);
    expect(v.message).toContain("Layer 'domain' is not allowed to import from layer 'infra'");
    expect(v.relatedLocations?.[0]?.filePath).toBe(paths[1]!);
  });

  it('flags an edge listed in denies even when allows is permissive', () => {
    const { dir, paths } = fixtureCreate({
      'src/ui/page.ts': 'import { db } from "../infra/db"; export const page = db;',
      'src/infra/db.ts': 'export const db = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      layers: {
        ui: { files: ['src/ui/**/*.ts'], denies: ['infra'] },
        infra: { files: ['src/infra/**/*.ts'] },
      },
    });

    const violations = noLayerViolationCheck(rule, context);
    expect(violations.length).toBe(1);
    expect(violations[0]!.message).toContain("not allowed to import from layer 'infra'");
  });

  it('allows intra-layer edges by default', () => {
    const { dir, paths } = fixtureCreate({
      'src/domain/a.ts': 'import { b } from "./b"; export const a = b;',
      'src/domain/b.ts': 'export const b = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      layers: {
        domain: { files: ['src/domain/**/*.ts'], allows: [] },
      },
    });
    expect(noLayerViolationCheck(rule, context)).toEqual([]);
  });

  it('ignores edges to/from unclassified files', () => {
    const { dir, paths } = fixtureCreate({
      'src/domain/m.ts': 'import { util } from "../shared/util"; export const m = util;',
      'src/shared/util.ts': 'export const util = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      layers: {
        domain: { files: ['src/domain/**/*.ts'], allows: [] },
        // shared has no layer assignment → edge ignored
      },
    });
    expect(noLayerViolationCheck(rule, context)).toEqual([]);
  });

  it('reports ambiguous layer assignment as a violation', () => {
    const { dir, paths } = fixtureCreate({
      'src/foo.ts': 'export const foo = 1;',
    });
    const { index } = projectIndexBuildSync({ files: paths, dir });
    const { rule, context } = contextCreate(dir, index, {
      layers: {
        // identical-length globs (9 chars) both match → ambiguous
        a: { files: ['src/f*.ts'] },
        b: { files: ['**/foo.ts'] },
      },
    });
    const violations = noLayerViolationCheck(rule, context);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.message.includes('ambiguous'))).toBe(true);
  });
});

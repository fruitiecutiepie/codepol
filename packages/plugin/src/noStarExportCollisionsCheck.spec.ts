import { describe, expect, it, beforeAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type PolicyRule,
  type PolicyCheckContext,
  type ProjectIndex,
} from '@codepol/core';
import { noStarExportCollisionsCheck } from './noStarExportCollisionsCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('noStarExportCollisionsCheck', () => {
  let testDir: string;

  function contextNew(
    filePath: string,
    source: string,
    index: ProjectIndex | undefined,
    ruleArgs: Record<string, unknown> = {},
  ): { rule: PolicyRule; context: PolicyCheckContext } {
    const rule: PolicyRule = {
      ruleId: 'no-star-export-collisions',
      description: 'Test rule',
      targets: [],
    };
    const target = {
      language: 'typescript' as const,
      files: ['**/*.ts'],
    };
    const policy = {
      targets: { 'ts-files': target },
      rules: [rule],
    };
    return {
      rule,
      context: {
        filePath,
        source,
        policy,
        dir: testDir,
        target,
        projectIndex: index,
        ruleArgs,
      },
    };
  }

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codepol-star-export-collisions-test-'),
    );
  });

  it('returns no violations when there are no star exports', () => {
    const barrel = path.join(testDir, 'noStarBarrel.ts');
    const barrelContent = `export const foo = 1;\nexport const bar = 2;\n`;
    fs.writeFileSync(barrel, barrelContent);

    const { index } = projectIndexBuildSync({
      files: [barrel],
      dir: testDir,
    });

    const { rule, context } = contextNew(barrel, barrelContent, index);
    const violations = noStarExportCollisionsCheck(rule, context);
    expect(violations).toHaveLength(0);
  });

  it('returns no violations when star exports have disjoint names', () => {
    const modA = path.join(testDir, 'disjointA.ts');
    const modB = path.join(testDir, 'disjointB.ts');
    const barrel = path.join(testDir, 'disjointBarrel.ts');

    fs.writeFileSync(modA, `export const alpha = 1;\nexport function beta() {}\n`);
    fs.writeFileSync(modB, `export const gamma = 2;\nexport type Delta = string;\n`);
    fs.writeFileSync(
      barrel,
      `export * from './disjointA';\nexport * from './disjointB';\n`,
    );

    const { index } = projectIndexBuildSync({
      files: [modA, modB, barrel],
      dir: testDir,
    });

    const barrelSource = fs.readFileSync(barrel, 'utf8');
    const { rule, context } = contextNew(barrel, barrelSource, index);
    const violations = noStarExportCollisionsCheck(rule, context);
    expect(violations).toHaveLength(0);
  });

  it('flags collisions when two star-exported modules share a name', () => {
    const modA = path.join(testDir, 'collideA.ts');
    const modB = path.join(testDir, 'collideB.ts');
    const barrel = path.join(testDir, 'collideBarrel.ts');

    fs.writeFileSync(
      modA,
      `export const shared = 'a';\nexport const onlyA = 1;\n`,
    );
    fs.writeFileSync(
      modB,
      `export const shared = 'b';\nexport const onlyB = 2;\n`,
    );
    fs.writeFileSync(
      barrel,
      `export * from './collideA';\nexport * from './collideB';\n`,
    );

    const { index } = projectIndexBuildSync({
      files: [modA, modB, barrel],
      dir: testDir,
    });

    const barrelSource = fs.readFileSync(barrel, 'utf8');
    const { rule, context } = contextNew(barrel, barrelSource, index);
    const violations = noStarExportCollisionsCheck(rule, context);

    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.message.includes("'shared'"))).toBe(true);
    expect(violations.some((v) => v.message.includes("'onlyA'"))).toBe(false);
    expect(violations.some((v) => v.message.includes("'onlyB'"))).toBe(false);
  });

  it('flags multiple collisions across multiple names', () => {
    const modA = path.join(testDir, 'multiA.ts');
    const modB = path.join(testDir, 'multiB.ts');
    const barrel = path.join(testDir, 'multiBarrel.ts');

    fs.writeFileSync(
      modA,
      `export const foo = 1;\nexport const bar = 2;\nexport const unique = 3;\n`,
    );
    fs.writeFileSync(
      modB,
      `export const foo = 10;\nexport const bar = 20;\nexport const other = 30;\n`,
    );
    fs.writeFileSync(
      barrel,
      `export * from './multiA';\nexport * from './multiB';\n`,
    );

    const { index } = projectIndexBuildSync({
      files: [modA, modB, barrel],
      dir: testDir,
    });

    const barrelSource = fs.readFileSync(barrel, 'utf8');
    const { rule, context } = contextNew(barrel, barrelSource, index);
    const violations = noStarExportCollisionsCheck(rule, context);

    const messages = violations.map((v) => v.message);
    expect(messages.some((m) => m.includes("'foo'"))).toBe(true);
    expect(messages.some((m) => m.includes("'bar'"))).toBe(true);
    expect(messages.some((m) => m.includes("'unique'"))).toBe(false);
    expect(messages.some((m) => m.includes("'other'"))).toBe(false);
  });

  it('does not flag local export collisions by default', () => {
    const modA = path.join(testDir, 'localDefaultA.ts');
    const barrel = path.join(testDir, 'localDefaultBarrel.ts');

    fs.writeFileSync(modA, `export const overlap = 'from A';\n`);
    fs.writeFileSync(
      barrel,
      `export * from './localDefaultA';\nexport const overlap = 'local';\n`,
    );

    const { index } = projectIndexBuildSync({
      files: [modA, barrel],
      dir: testDir,
    });

    const barrelSource = fs.readFileSync(barrel, 'utf8');
    const { rule, context } = contextNew(barrel, barrelSource, index);
    const violations = noStarExportCollisionsCheck(rule, context);

    // Without includeLocalExports, no violation for local vs star collision
    expect(violations).toHaveLength(0);
  });

  it('flags local export collisions when includeLocalExports is true', () => {
    const modA = path.join(testDir, 'localFlagA.ts');
    const barrel = path.join(testDir, 'localFlagBarrel.ts');

    fs.writeFileSync(modA, `export const overlap = 'from A';\n`);
    fs.writeFileSync(
      barrel,
      `export * from './localFlagA';\nexport const overlap = 'local';\n`,
    );

    const { index } = projectIndexBuildSync({
      files: [modA, barrel],
      dir: testDir,
    });

    const barrelSource = fs.readFileSync(barrel, 'utf8');
    const { rule, context } = contextNew(barrel, barrelSource, index, {
      includeLocalExports: true,
    });
    const violations = noStarExportCollisionsCheck(rule, context);

    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(
      violations.some(
        (v) =>
          v.message.includes("'overlap'") &&
          v.message.includes('Local export'),
      ),
    ).toBe(true);
  });

  it('returns empty when projectIndex is not available', () => {
    const barrel = path.join(testDir, 'noIndexBarrel.ts');
    const barrelContent = `export * from './something';\n`;
    fs.writeFileSync(barrel, barrelContent);

    const { rule, context } = contextNew(barrel, barrelContent, undefined);
    const violations = noStarExportCollisionsCheck(rule, context);
    expect(violations).toHaveLength(0);
  });

  it('ignores default exports from star-exported modules', () => {
    const modA = path.join(testDir, 'defaultIgnoreA.ts');
    const modB = path.join(testDir, 'defaultIgnoreB.ts');
    const barrel = path.join(testDir, 'defaultIgnoreBarrel.ts');

    fs.writeFileSync(
      modA,
      `const x = 1;\nexport default x;\nexport const unique = 'a';\n`,
    );
    fs.writeFileSync(
      modB,
      `const y = 2;\nexport default y;\nexport const other = 'b';\n`,
    );
    fs.writeFileSync(
      barrel,
      `export * from './defaultIgnoreA';\nexport * from './defaultIgnoreB';\n`,
    );

    const { index } = projectIndexBuildSync({
      files: [modA, modB, barrel],
      dir: testDir,
    });

    const barrelSource = fs.readFileSync(barrel, 'utf8');
    const { rule, context } = contextNew(barrel, barrelSource, index);
    const violations = noStarExportCollisionsCheck(rule, context);

    // Default exports are not propagated by `export *`, so no collision
    expect(violations).toHaveLength(0);
  });
});

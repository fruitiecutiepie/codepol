/**
 * End-to-end tests for the `fixProvider` capability on rules whose autofix
 * logic lives inside their tree-check (`violation.fix.edits`). Each test
 * writes tmp files, drives `fixProvider.apply`, and asserts disk rewrites.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type FixProviderContext,
  type PolicyFile,
  type PolicyRuleTargetContext,
} from '@codepol/core';
import { enforceCasingRule } from './enforceCasingRule';
import { noUnusedVarsRule } from './noUnusedVarsRule';
import { noMixedExportsRule } from './noMixedExportsRule';

let workRoot: string;

beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-fix-providers-'));
});

function caseDirNew(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(workRoot, `${prefix}-`));
  return dir;
}

function policyEmpty(): PolicyFile {
  return { targets: {}, rules: [] };
}

function fixContextNew(input: {
  cwd: string;
  files: string[];
  ruleId: string;
  args?: unknown;
  language?: string;
  buildIndex?: boolean;
}): FixProviderContext {
  const target = {
    language: input.language ?? 'typescript',
    files: ['**/*.ts', '**/*.tsx'],
  };
  const ruleTarget: PolicyRuleTargetContext = {
    ruleId: input.ruleId,
    args: input.args,
    target,
  };
  let projectIndex;
  if (input.buildIndex) {
    projectIndex = projectIndexBuildSync({
      files: input.files,
      dir: input.cwd,
    }).index;
  }
  return {
    cwd: input.cwd,
    policy: policyEmpty(),
    configPath: path.join(input.cwd, 'codepol.toml'),
    files: input.files,
    ruleTargets: [ruleTarget],
    projectIndex,
  };
}

describe('enforceCasingRule.fixProvider', () => {
  it('renames a snake_case const to camelCase across file', async () => {
    const dir = caseDirNew('casing');
    const filePath = path.join(dir, 'sample.ts');
    fs.writeFileSync(filePath, 'const bad_name = 1;\nconsole.log(bad_name);\n');

    const provider = enforceCasingRule.capabilities.fixProvider;
    expect(provider).toBeDefined();

    await provider!.apply(
      fixContextNew({
        cwd: dir,
        files: [filePath],
        ruleId: '@codepol/plugin/enforce-casing',
        args: { symbols: { const: ['camelCase'] } },
        buildIndex: true,
      }),
    );

    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).toContain('const badName = 1');
    expect(after).toContain('console.log(badName)');
    expect(after).not.toContain('bad_name');
  });

  it('skips files of unsupported language', async () => {
    const dir = caseDirNew('casing-skip');
    const filePath = path.join(dir, 'sample.unknown');
    const original = 'no parser for this extension\n';
    fs.writeFileSync(filePath, original);

    const provider = enforceCasingRule.capabilities.fixProvider;
    await provider!.apply(
      fixContextNew({
        cwd: dir,
        files: [filePath],
        ruleId: '@codepol/plugin/enforce-casing',
        args: { symbols: { variable: ['camelCase'] } },
      }),
    );

    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
  });
});

describe('noUnusedVarsRule.fixProvider', () => {
  it('removes an unused const declaration', async () => {
    const dir = caseDirNew('unused');
    const filePath = path.join(dir, 'sample.ts');
    fs.writeFileSync(
      filePath,
      'const unused = 1;\nexport const keep = 2;\n',
    );

    const provider = noUnusedVarsRule.capabilities.fixProvider;
    expect(provider).toBeDefined();

    await provider!.apply(
      fixContextNew({
        cwd: dir,
        files: [filePath],
        ruleId: '@codepol/plugin/no-unused-vars',
        args: undefined,
        buildIndex: true,
      }),
    );

    const after = fs.readFileSync(filePath, 'utf8');
    expect(after).not.toContain('const unused');
    expect(after).toContain('export const keep = 2');
  });
});

describe('noMixedExportsRule.fixProvider', () => {
  it('rewrites default export to named export when preferredStyle is named', async () => {
    const dir = caseDirNew('mixed');
    const targetPath = path.join(dir, 'mixed.ts');
    fs.writeFileSync(
      targetPath,
      [
        'export const helper = () => 1;',
        'function widget() { return 2; }',
        'export default widget;',
        '',
      ].join('\n'),
    );

    const provider = noMixedExportsRule.capabilities.fixProvider;
    expect(provider).toBeDefined();

    await provider!.apply(
      fixContextNew({
        cwd: dir,
        files: [targetPath],
        ruleId: '@codepol/plugin/no-mixed-exports',
        args: { preferredStyle: 'named' },
        buildIndex: true,
      }),
    );

    const after = fs.readFileSync(targetPath, 'utf8');
    expect(after).not.toContain('export default');
    expect(after).toContain('export { widget }');
  });

  it('is a no-op when projectIndex is missing', async () => {
    const dir = caseDirNew('mixed-noindex');
    const targetPath = path.join(dir, 'mixed.ts');
    const original = [
      'export const helper = () => 1;',
      'function widget() { return 2; }',
      'export default widget;',
      '',
    ].join('\n');
    fs.writeFileSync(targetPath, original);

    const provider = noMixedExportsRule.capabilities.fixProvider;
    await provider!.apply(
      fixContextNew({
        cwd: dir,
        files: [targetPath],
        ruleId: '@codepol/plugin/no-mixed-exports',
        args: { preferredStyle: 'named' },
        buildIndex: false,
      }),
    );

    expect(fs.readFileSync(targetPath, 'utf8')).toBe(original);
  });
});

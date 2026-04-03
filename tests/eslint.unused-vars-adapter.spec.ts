import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  eslintAdapter,
  policyCacheClear,
  projectIndexCacheClear,
} from '@codepol/plugin-eslint';
import { noUnusedVarsRule } from '@codepol/plugin';
import { configCacheClear, langAdd, parserInit } from '@codepol/core';

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'codepol-no-unused-vars-eslint-'),
);

const invalidSource = `
function demo(ignoredUsedArg) {
  console.log(ignoredUsedArg);
}

demo(1);
`;

const validSource = `
function demo(_unusedArg, data, items) {
  const { skipped, ...rest } = data;
  const [_slot, live] = items;

  try {
    doWork();
  } catch (ignoredErr) {
    console.log(1);
  }

  console.log(rest, live);
}

demo(1, obj, arr);
`;

fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(tempDir, 'src', 'invalid.ts'), invalidSource);
fs.writeFileSync(path.join(tempDir, 'src', 'valid.ts'), validSource);

const configPath = path.join(tempDir, 'codepol.toml');
fs.writeFileSync(
  configPath,
  `[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "no-unused-vars"
ruleId = "@codepol/plugin/no-unused-vars"
targets = ["src"]
args.args = "all"
args.argsIgnorePattern = "^(?:_|ignored)"
args.caughtErrorsIgnorePattern = "^ignored"
args.destructuredArrayIgnorePattern = "^_"
args.ignoreRestSiblings = true
args.reportUsedIgnorePattern = true
`,
);

let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();

  configCacheClear();
  policyCacheClear();
  projectIndexCacheClear();

  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
});

afterAll(() => {
  cwdSpy?.mockRestore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const eslintRule = eslintAdapter.adapt(noUnusedVarsRule, {
  ruleName: 'adapted-no-unused-vars',
});

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as any,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

const ruleOptions = [
  {
    configPath,
    policyExclude: [] as string[],
  },
];

ruleTester.run('adapted-no-unused-vars', eslintRule as any, {
  valid: [
    {
      name: 'ignore patterns suppress supported bindings',
      filename: path.join(tempDir, 'src', 'valid.ts'),
      options: ruleOptions,
      code: validSource,
    },
  ],
  invalid: [
    {
      name: 'reportUsedIgnorePattern surfaces used ignored args',
      filename: path.join(tempDir, 'src', 'invalid.ts'),
      options: ruleOptions,
      code: invalidSource,
      errors: [{ messageId: 'treeCheckViolation' }],
    },
  ],
});

describe('eslint adapter with native no-unused-vars', () => {
  it('adapts the native rule through treeCheckProvider metadata', () => {
    expect(eslintRule).toBeDefined();
    expect(eslintRule.meta?.messages).toHaveProperty('treeCheckViolation');
    expect(eslintRule.create).toBeInstanceOf(Function);
  });
});

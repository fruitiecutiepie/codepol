import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ESLint, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  eslintAdapter,
  eslintPluginCreate,
  policyCacheClear,
  projectIndexCacheClear,
} from '@codepol/plugin-eslint';
import pluginRules, { noUnusedVarsRule } from '@codepol/plugin';
import {
  configCacheClear,
  langAdd,
  parserInit,
  pluginBuiltinRegister,
  providerRulesConfigGet,
} from '@codepol/core';

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

const shippedPluginInvalidSource = `
function demo() {
  const unused = 1;
  const used = 2;
  console.log(used);
}

demo();
`;

const shippedPluginFixedSource = `
function demo() {
  const used = 2;
  console.log(used);
}

demo();
`;

fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(tempDir, 'src', 'invalid.ts'), invalidSource);
fs.writeFileSync(path.join(tempDir, 'src', 'valid.ts'), validSource);
fs.writeFileSync(
  path.join(tempDir, 'src', 'shipped-invalid.ts'),
  shippedPluginInvalidSource,
);

const configPath = path.join(tempDir, 'codepol.toml');
fs.writeFileSync(
  configPath,
  `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
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
  pluginBuiltinRegister('@codepol/plugin', pluginRules);

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

  it('ships no-unused-vars through eslintPluginCreate with policy-backed options', async () => {
    const plugin = eslintPluginCreate(pluginRules);
    const shippedRule = (plugin as any).rules['no-unused-vars'];
    expect(shippedRule).toBeDefined();

    const providerRules = await providerRulesConfigGet('eslint', configPath) as Record<
      string,
      [string, Record<string, unknown>]
    >;
    expect(providerRules['codepol/no-unused-vars']).toBeDefined();

    const baseConfig = [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tseslint.parser as any,
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
          },
        },
        rules: providerRules,
      },
    ];

    const lint = new ESLint({
      cwd: tempDir,
      ignore: false,
      overrideConfigFile: true,
      plugins: {
        codepol: plugin as any,
      },
      overrideConfig: baseConfig,
    });

    const [result] = await lint.lintText(shippedPluginInvalidSource, {
      filePath: path.join(tempDir, 'src', 'shipped-invalid.ts'),
    });
    expect(result?.messages).toEqual([
      expect.objectContaining({
        ruleId: 'codepol/no-unused-vars',
        message: "'unused' is assigned a value but never used.",
      }),
    ]);

    const lintWithFix = new ESLint({
      cwd: tempDir,
      fix: true,
      ignore: false,
      overrideConfigFile: true,
      plugins: {
        codepol: plugin as any,
      },
      overrideConfig: baseConfig,
    });

    const [fixedResult] = await lintWithFix.lintText(shippedPluginInvalidSource, {
      filePath: path.join(tempDir, 'src', 'shipped-invalid.ts'),
    });
    expect(fixedResult?.output).toBe(shippedPluginFixedSource);
  });
});

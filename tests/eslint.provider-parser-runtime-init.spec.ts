import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import codepolBuiltin from '@codepol/plugin';
import {
  pluginBuiltinRegister,
  policyPluginRulesGet,
  providerParserRuntimeInit,
  providerRulesConfigGet,
} from '@codepol/core';

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'codepol-eslint-provider-runtime-'),
);
const configPath = path.join(tempDir, 'codepol.toml');
const filePath = path.join(tempDir, 'src', 'contracts.ts');
const source = `interface DemoContract {\n  name: string;\n}\n`;

describe('providerParserRuntimeInit eslint integration', () => {
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
    fs.writeFileSync(
      configPath,
      `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["src"]
`,
    );
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  });

  afterAll(() => {
    cwdSpy?.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps adapted-rule parser bootstrap explicit', async () => {
    const plugin = eslintPluginCreate(await policyPluginRulesGet(configPath));
    const providerRules = await providerRulesConfigGet(
      'eslint',
      configPath,
    ) as Linter.RulesRecord;
    const overrideConfig: Linter.Config[] = [
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

    const lintWithoutRuntime = new ESLint({
      cwd: tempDir,
      ignore: false,
      overrideConfigFile: true,
      plugins: {
        codepol: plugin as any,
      },
      overrideConfig,
    });
    const [withoutRuntime] = await lintWithoutRuntime.lintText(source, {
      filePath,
    });

    expect(withoutRuntime?.messages).toEqual([
      expect.objectContaining({
        ruleId: 'codepol/no-interface',
        message: expect.stringContaining('Parser not initialized'),
      }),
    ]);

    await providerParserRuntimeInit('eslint');

    const lintWithRuntime = new ESLint({
      cwd: tempDir,
      ignore: false,
      overrideConfigFile: true,
      plugins: {
        codepol: plugin as any,
      },
      overrideConfig,
    });
    const [withRuntime] = await lintWithRuntime.lintText(source, {
      filePath,
    });

    expect(withRuntime?.messages).toEqual([
      expect.objectContaining({
        ruleId: 'codepol/no-interface',
        message: "Use 'type' instead of 'interface' for 'DemoContract'",
      }),
    ]);
  });
});

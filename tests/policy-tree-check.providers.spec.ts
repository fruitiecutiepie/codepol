import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  policyPluginsGet,
  policyViolationsGetForFile,
  pluginBuiltinRegister,
  isOk,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

describe('policyViolationsGetForFile providers filter', () => {
  it('returns empty when rule.providers excludes tree-sitter', async () => {
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-providers-'));
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    const filePath = path.join(testDir, 'src', 'dummy.ts');
    fs.writeFileSync(filePath, 'export function run() { return 1; }\n', 'utf8');

    const policy = {
      targets: {
        src: { language: 'typescript' as const, files: ['src/**/*.ts'] },
      },
      plugins: [{ id: '@codepol/plugin', source: { kind: 'builtin' as const } }],
      rules: [
        {
          ruleId: '@codepol/plugin/require-logger-enter-exit',
          targets: ['src'],
          providers: ['eslint'],
          args: {
            logger: {
              identifier: 'logger',
              enterMethod: 'enter',
              exitMethod: 'exit',
              import: { module: './logger', named: 'logger' },
            },
          },
        },
      ],
    };

    const pluginsResult = await policyPluginsGet(policy, testDir, {});
    expect(isOk(pluginsResult)).toBe(true);
    if (!isOk(pluginsResult)) return;

    const violations = policyViolationsGetForFile(
      filePath,
      policy.rules[0]!,
      policy.targets.src,
      policy,
      pluginsResult.Ok,
      testDir,
    );
    expect(isOk(violations)).toBe(true);
    if (isOk(violations)) {
      expect(violations.Ok).toEqual([]);
    }

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});

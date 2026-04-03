import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  policyCheck,
  langAdd,
  parserInit,
  isOk,
  isErr,
  configCacheClear,
  pluginBuiltinRegister,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

describe('policyCheck enforce-casing', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codepol-enforce-casing-e2e-'),
    );

    const configContent = `exclude = []

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "casing"
ruleId = "@codepol/plugin/enforce-casing"
targets = ["src"]

[rules.args.paths]
file = ["kebab-case"]
directory = ["kebab-case"]
`;

    fs.writeFileSync(path.join(testDir, 'codepol.toml'), configContent, 'utf8');
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'src', 'badFileName.ts'),
      'export const x = 1;\n',
      'utf8',
    );
  });

  afterAll(() => {
    configCacheClear();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('loads config and reports path casing violations', async () => {
    const configPath = path.join(testDir, 'codepol.toml');
    const result = await policyCheck({ configPath, cwd: testDir });

    if (isErr(result)) {
      throw new Error(`policyCheck returned Err: ${result.Err}`);
    }
    expect(isOk(result)).toBe(true);

    const { treeViolations } = result.Ok;
    const casing = treeViolations.filter(
      (v) => v.ruleId === 'casing' && v.message.includes('File name'),
    );
    expect(casing.length).toBeGreaterThanOrEqual(1);
    expect(casing[0].message).toContain('badFileName');
  });
});

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

describe('policyCheck no-mixed-exports', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codepol-no-mixed-exports-e2e-'),
    );

    const configContent = `exclude = []

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "no-mixed-exports"
ruleId = "@codepol/plugin/no-mixed-exports"
targets = ["src"]
args.preferredStyle = "named"
`;

    fs.writeFileSync(path.join(testDir, 'codepol.toml'), configContent, 'utf8');
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'src', 'mixed.ts'),
      'export default 1;\nexport const x = 2;\n',
      'utf8',
    );
  });

  afterAll(() => {
    configCacheClear();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('loads config and reports mixed export violation', async () => {
    const configPath = path.join(testDir, 'codepol.toml');
    const result = await policyCheck({ configPath, cwd: testDir });

    if (isErr(result)) {
      throw new Error(`policyCheck returned Err: ${result.Err}`);
    }
    expect(isOk(result)).toBe(true);

    const { treeViolations } = result.Ok;
    const mixed = treeViolations.filter(
      (v) =>
        v.ruleId === 'no-mixed-exports' &&
        v.message.includes('prefer named exports'),
    );
    expect(mixed.length).toBeGreaterThanOrEqual(1);
    expect(mixed[0].filePath).toContain('mixed.ts');
    expect(mixed[0].line).toBe(1);
  });
});

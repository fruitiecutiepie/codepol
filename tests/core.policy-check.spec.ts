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

describe('policyCheck full pipeline', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-policycheck-'));

    const configContent = `exclude = []

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "function-logging"
ruleId = "@codepol/plugin/require-logger-enter-exit"
description = "Ensure functions include logger enter/exit"
targets = ["src"]

[rules.args.logger]
identifier = "logger"
enterMethod = "enter"
exitMethod = "exit"
import = { module = "./logger", named = "logger" }
`;
    fs.writeFileSync(path.join(testDir, 'codepol.toml'), configContent, 'utf8');

    // Create a source file that violates the logger rule.
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'src', 'app.ts'),
      'export function run() { return 1; }\n',
      'utf8'
    );
  });

  afterAll(() => {
    configCacheClear();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('loads config, finds files, and returns violations', async () => {
    const configPath = path.join(testDir, 'codepol.toml');
    const result = await policyCheck({ configPath, cwd: testDir });

    if (isErr(result)) {
      throw new Error(`policyCheck returned Err: ${result.Err}`);
    }
    expect(isOk(result)).toBe(true);

    const { policy, files, treeViolations } = result.Ok;

    // Config loaded correctly
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0].ruleId).toBe('@codepol/plugin/require-logger-enter-exit');

    // Files matched
    expect(files.length).toBeGreaterThanOrEqual(1);
    const relativeFiles = files.map(f => path.relative(testDir, f));
    expect(relativeFiles).toContain(path.join('src', 'app.ts'));

    // Violations found
    expect(treeViolations.length).toBeGreaterThanOrEqual(1);
    expect(treeViolations[0].message).toContain('run');
    expect(treeViolations[0].ruleId).toBe('function-logging');
  });

  it('returns Err when config file does not exist', async () => {
    const result = await policyCheck({
      configPath: path.join(testDir, 'nonexistent.toml'),
      cwd: testDir,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.Err).toContain('not found');
    }
  });
});

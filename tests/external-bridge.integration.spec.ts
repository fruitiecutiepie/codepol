import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodepolConfig } from '@codepol/core';
import { policyCheck } from '../apps/cli/src/index';
import { configValidate } from '../packages/core/src/config/configValidate';

const ESLINT_BRIDGE_RULE_ID = '@codepol/plugin/eslint';
const BIOME_BRIDGE_RULE_ID = '@codepol/plugin/biome';
const RUFF_BRIDGE_RULE_ID = '@codepol/plugin/ruff';

function tempProjectCreate(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mockRuffScriptCreate(projectDir: string): { ruffBin: string; tracePath: string } {
  const tracePath = path.join(projectDir, 'ruff-trace.log');
  const ruffBin = path.join(projectDir, 'mock-ruff.cjs');

  fs.writeFileSync(
    ruffBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const tracePath = process.env.MOCK_RUFF_TRACE;
if (tracePath) {
  fs.appendFileSync(tracePath, JSON.stringify(args) + '\\n', 'utf8');
}

const isCheck = args.includes('check');
if (!isCheck) {
  // Fix invocation: consume and exit cleanly.
  process.exit(0);
}

const files = args.filter(
  (arg) => !arg.startsWith('-') && arg !== 'check',
);
const diagnostics = files
  .map((file) => ({
    filename: file,
    code: 'E501',
    message: 'line too long',
    location: { row: 1, column: 1 },
    end_location: { row: 1, column: 10 },
    fix: null,
    url: null,
  }))
  .filter(() => true);

process.stdout.write(JSON.stringify(diagnostics));
// Mock always exits 0 to avoid exercising async ruff runner exit-code paths
// unrelated to args plumbing validation.
process.exit(0);
`,
    'utf8',
  );
  fs.chmodSync(ruffBin, 0o755);
  return { ruffBin, tracePath };
}

function ruffPolicyConfigCreate(
  projectDir: string,
  ruffBin: string,
  args: { select?: string[]; ignore?: string[] } = {},
): CodepolConfig {
  fs.writeFileSync(
    path.join(projectDir, 'codepol.toml'),
    '# fixture\n',
    'utf8',
  );
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });

  return {
    targets: {
      py: {
        language: 'python',
        files: ['src/**/*.py'],
      },
    },
    plugins: [
      {
        id: '@codepol/plugin',
        source: { kind: 'builtin' },
      },
    ],
    rules: [
      {
        ruleId: RUFF_BRIDGE_RULE_ID,
        targets: ['py'],
        providers: ['ruff'],
        args: {
          ruffBin,
          ...args,
        },
      },
    ],
  };
}

function biomePolicyConfigCreate(
  projectDir: string,
  biomeBin: string,
  args: { configPath?: string; extraArgs?: string[] } = {},
): CodepolConfig {
  fs.writeFileSync(
    path.join(projectDir, 'codepol.toml'),
    '# fixture\n',
    'utf8',
  );
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });

  return {
    targets: {
      ts: {
        language: 'typescript',
        files: ['src/**/*.ts'],
      },
    },
    plugins: [
      {
        id: '@codepol/plugin',
        source: { kind: 'builtin' },
      },
    ],
    rules: [
      {
        ruleId: BIOME_BRIDGE_RULE_ID,
        targets: ['ts'],
        providers: ['biome'],
        args: {
          biomeBin,
          ...args,
        },
      },
    ],
  };
}

function biomeMockScriptCreate(projectDir: string): { biomeBin: string; tracePath: string } {
  const tracePath = path.join(projectDir, 'biome-trace.log');
  const biomeBin = path.join(projectDir, 'mock-biome.cjs');

  fs.writeFileSync(
    biomeBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const tracePath = process.env.MOCK_BIOME_TRACE;
if (tracePath) {
  fs.appendFileSync(tracePath, JSON.stringify(args) + '\\n', 'utf8');
}
process.stdout.write(JSON.stringify({ source: { name: 'Biome' }, diagnostics: [] }));
process.exit(0);
`,
    'utf8',
  );
  fs.chmodSync(biomeBin, 0o755);
  return { biomeBin, tracePath };
}

describe('external bridge rules integration', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    createdDirs.length = 0;
  });

  it('@codepol/plugin/ruff: args.select reaches the ruff binary and violations surface', async () => {
    const projectDir = tempProjectCreate('codepol-ext-bridge-ruff-');
    createdDirs.push(projectDir);
    const { ruffBin, tracePath } = mockRuffScriptCreate(projectDir);
    const config = ruffPolicyConfigCreate(projectDir, ruffBin, {
      select: ['E', 'F'],
      ignore: ['E501'],
    });
    const pyFile = path.join(projectDir, 'src', 'app.py');
    fs.writeFileSync(pyFile, 'x = 1\n', 'utf8');

    const originalEnv = process.env.MOCK_RUFF_TRACE;
    process.env.MOCK_RUFF_TRACE = tracePath;
    try {
      const result = await policyCheck({
        config,
        configPath: path.join(projectDir, 'codepol.toml'),
        fix: false,
        cwd: projectDir,
        env: {
          ...process.env,
          CODEPOL_WORKSPACE_SERVICE_MODE: 'in_process',
        },
      });

      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      const traceLines = fs
        .readFileSync(tracePath, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
      expect(traceLines.length).toBeGreaterThanOrEqual(1);
      const checkCall = traceLines
        .map((line) => JSON.parse(line) as string[])
        .find((argv) => argv.includes('check'));
      expect(checkCall).toBeDefined();
      expect(checkCall).toContain('--select=E,F');
      expect(checkCall).toContain('--ignore=E501');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MOCK_RUFF_TRACE;
      } else {
        process.env.MOCK_RUFF_TRACE = originalEnv;
      }
    }
  });

  it('@codepol/plugin/biome: args.configPath reaches the biome binary', async () => {
    const projectDir = tempProjectCreate('codepol-ext-bridge-biome-');
    createdDirs.push(projectDir);
    const { biomeBin, tracePath } = biomeMockScriptCreate(projectDir);
    const biomeConfigPath = path.join(projectDir, 'biome.json');
    fs.writeFileSync(biomeConfigPath, '{"$schema":"https://biomejs.dev/schemas/1.0.0/schema.json"}', 'utf8');
    const config = biomePolicyConfigCreate(projectDir, biomeBin, {
      configPath: biomeConfigPath,
    });
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    const originalEnv = process.env.MOCK_BIOME_TRACE;
    process.env.MOCK_BIOME_TRACE = tracePath;
    try {
      await policyCheck({
        config,
        configPath: path.join(projectDir, 'codepol.toml'),
        fix: false,
        cwd: projectDir,
        env: {
          ...process.env,
          CODEPOL_WORKSPACE_SERVICE_MODE: 'in_process',
        },
      });

      const traceLines = fs
        .readFileSync(tracePath, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
      const checkCall = traceLines
        .map((line) => JSON.parse(line) as string[])
        .find((argv) => argv.includes('lint'));
      expect(checkCall).toBeDefined();
      const configIndex = checkCall!.findIndex((arg) =>
        arg.startsWith('--config-path'),
      );
      expect(configIndex).toBeGreaterThanOrEqual(0);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MOCK_BIOME_TRACE;
      } else {
        process.env.MOCK_BIOME_TRACE = originalEnv;
      }
    }
  });

  it('top-level eslintConfigPath: configValidate rejects with a migration message', () => {
    expect(() =>
      configValidate({
        eslintConfigPath: './eslint.config.mjs',
        targets: {},
        rules: [],
      }),
    ).toThrowError(/@codepol\/plugin\/eslint/);
  });

  it('codepol-defined ESLint rule without the bridge: analyzer throws with migration hint', async () => {
    const projectDir = tempProjectCreate('codepol-ext-bridge-no-bridge-');
    createdDirs.push(projectDir);
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'eslint.config.mjs'),
      `export default [{ files: ['**/*.ts'], rules: {} }];\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');
    fs.writeFileSync(path.join(projectDir, 'codepol.toml'), '# fixture\n', 'utf8');

    const config: CodepolConfig = {
      targets: {
        ts: {
          language: 'typescript',
          files: ['src/**/*.ts'],
        },
      },
      plugins: [
        {
          id: '@codepol/plugin',
          source: { kind: 'builtin' },
        },
      ],
      rules: [
        {
          ruleId: '@codepol/plugin/no-unused-vars',
          targets: ['ts'],
        },
      ],
    };

    await expect(
      policyCheck({
        config,
        configPath: path.join(projectDir, 'codepol.toml'),
        fix: false,
        cwd: projectDir,
        env: {
          ...process.env,
          CODEPOL_WORKSPACE_SERVICE_MODE: 'in_process',
        },
      }),
    ).rejects.toThrowError(/@codepol\/plugin\/eslint/);
  });

  it('@codepol/plugin/eslint alone triggers ESLint against user eslint.config.mjs', async () => {
    const projectDir = tempProjectCreate('codepol-ext-bridge-eslint-');
    createdDirs.push(projectDir);
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'eslint.config.mjs'),
      `export default [{
  files: ['**/*.ts'],
  rules: { 'no-debugger': 'error' },
}];\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(projectDir, 'src', 'app.ts'),
      'export function f() { debugger; return 1; }\n',
      'utf8',
    );
    fs.writeFileSync(path.join(projectDir, 'codepol.toml'), '# fixture\n', 'utf8');

    const config: CodepolConfig = {
      targets: {
        ts: {
          language: 'typescript',
          files: ['src/**/*.ts'],
        },
      },
      plugins: [
        {
          id: '@codepol/plugin',
          source: { kind: 'builtin' },
        },
      ],
      rules: [
        {
          ruleId: ESLINT_BRIDGE_RULE_ID,
          targets: ['ts'],
          args: {
            configPath: './eslint.config.mjs',
          },
        },
      ],
    };

    const result = await policyCheck({
      config,
      configPath: path.join(projectDir, 'codepol.toml'),
      fix: false,
      cwd: projectDir,
      env: {
        ...process.env,
        CODEPOL_WORKSPACE_SERVICE_MODE: 'in_process',
      },
    });

    const hasDebuggerDiag = result.workspaceDiagnostics.some(
      (diagnostic) =>
        diagnostic.source === 'eslint' && diagnostic.code === 'no-debugger',
    );
    expect(hasDebuggerDiag).toBe(true);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pluginModuleRegister,
  pluginRuleNew,
  treeCheckProviderNew,
  type CodepolConfig,
} from '@codepol/core';
import { policyCheck } from '../apps/cli/src/index';

const TEST_PLUGIN_ID = 'test-biome-plugin';
const TEST_PLUGIN_SCOPED_ID = 'test-biome-scoped-plugin';
const TEST_PLUGIN_MULTI_ID = 'test-biome-multi-config-plugin';
const TEST_PLUGIN_CONFLICT_ID = 'test-biome-conflict-plugin';

function tempProjectCreate(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-biome-integration-'));

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'eslint.config.mjs'),
    'export default [{ files: ["**/*.{ts,tsx,js,jsx}"], rules: {} }];\n',
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'codepol.toml'), '# integration test\n', 'utf8');

  return dir;
}

function mockBiomeScriptCreate(projectDir: string): { biomeBin: string; tracePath: string } {
  const tracePath = path.join(projectDir, 'biome-trace.log');
  const biomeBin = path.join(projectDir, 'mock-biome.cjs');

  fs.writeFileSync(
    biomeBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const tracePath = process.env.MOCK_BIOME_TRACE;
if (tracePath) {
  fs.appendFileSync(tracePath, JSON.stringify(args) + '\\n', 'utf8');
}

const files = args.filter((arg) => arg !== 'lint' && !arg.startsWith('--'));
const write = args.includes('--write');
const diagnostics = [];

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');
  if (write) {
    source = source.replace(/ == /g, ' === ');
    fs.writeFileSync(file, source, 'utf8');
  }

  const badIndex = source.indexOf(' == ');
  if (badIndex === -1) {
    continue;
  }

  diagnostics.push({
    code: { value: 'lint/suspicious/noDoubleEquals' },
    location: {
      path: path.relative(process.cwd(), file),
      range: {
        start: { line: 0, column: badIndex + 1 },
        end: { line: 0, column: badIndex + 3 }
      }
    },
    message: 'Use === instead of =='
  });
}

process.stdout.write(JSON.stringify({
  source: { name: 'Biome', url: 'https://biomejs.dev' },
  diagnostics
}));
process.exit(diagnostics.length > 0 ? 1 : 0);
`,
    'utf8'
  );
  fs.chmodSync(biomeBin, 0o755);

  return { biomeBin, tracePath };
}

function policyConfigCreate(biomeBin: string): CodepolConfig {
  const biomeRule = pluginRuleNew({
    id: 'mock-biome',
    capabilities: {
      lintProviders: [
        {
          platform: 'biome',
          languages: ['typescript', 'tsx', 'javascript', 'jsx'],
          config: {
            biomeBin,
          },
        },
      ],
    },
  });

  pluginModuleRegister(TEST_PLUGIN_ID, { default: [biomeRule] });

  return {
    targets: {
      src: {
        language: 'typescript',
        files: ['src/**/*.ts'],
      },
    },
    plugins: [
      {
        id: TEST_PLUGIN_ID,
        source: { kind: 'builtin' },
      },
    ],
    rules: [
      {
        ruleId: `${TEST_PLUGIN_ID}/mock-biome`,
        targets: ['src'],
        providers: ['biome'],
      },
    ],
  };
}

describe('biome provider integration', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('discovers and executes biome lint providers through the CLI pipeline', async () => {
    const projectDir = tempProjectCreate();
    createdDirs.push(projectDir);
    const { biomeBin, tracePath } = mockBiomeScriptCreate(projectDir);
    const config = policyConfigCreate(biomeBin);
    const filePath = path.join(projectDir, 'src', 'app.ts');
    fs.writeFileSync(filePath, 'export const bad = left == right;\n', 'utf8');

    const originalEnv = process.env.MOCK_BIOME_TRACE;
    process.env.MOCK_BIOME_TRACE = tracePath;

    try {
      const result = await policyCheck({
        config,
        configPath: path.join(projectDir, 'codepol.toml'),
        eslintConfigPath: path.join(projectDir, 'eslint.config.mjs'),
        fix: false,
        cwd: projectDir,
      });

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        ruleId: 'lint/suspicious/noDoubleEquals',
        filePath,
        message: 'Use === instead of ==',
      });

      const traceLines = fs.readFileSync(tracePath, 'utf8').trim().split('\n');
      expect(traceLines).toHaveLength(1);
      const args = JSON.parse(traceLines[0]) as string[];
      expect(args).toContain('lint');
      expect(args).toContain('--reporter=rdjson');
      expect(args).toContain(filePath);
      expect(args).not.toContain('--write');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MOCK_BIOME_TRACE;
      } else {
        process.env.MOCK_BIOME_TRACE = originalEnv;
      }
    }
  });

  it('runs biome in fix mode only when biome providers are present', async () => {
    const projectDir = tempProjectCreate();
    createdDirs.push(projectDir);
    const { biomeBin, tracePath } = mockBiomeScriptCreate(projectDir);
    const config = policyConfigCreate(biomeBin);
    const filePath = path.join(projectDir, 'src', 'app.ts');
    fs.writeFileSync(filePath, 'export const bad = left == right;\n', 'utf8');

    const originalEnv = process.env.MOCK_BIOME_TRACE;
    process.env.MOCK_BIOME_TRACE = tracePath;

    try {
      const result = await policyCheck({
        config,
        configPath: path.join(projectDir, 'codepol.toml'),
        eslintConfigPath: path.join(projectDir, 'eslint.config.mjs'),
        fix: true,
        cwd: projectDir,
      });

      expect(result.violations).toEqual([]);
      expect(fs.readFileSync(filePath, 'utf8')).toContain('===');

      const traceLines = fs.readFileSync(tracePath, 'utf8').trim().split('\n');
      expect(traceLines).toHaveLength(2);
      const firstArgs = JSON.parse(traceLines[0]) as string[];
      const secondArgs = JSON.parse(traceLines[1]) as string[];
      expect(firstArgs).toContain('--write');
      expect(secondArgs).not.toContain('--write');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MOCK_BIOME_TRACE;
      } else {
        process.env.MOCK_BIOME_TRACE = originalEnv;
      }
    }
  });

  it('runs biome only on files matched by rules that enable the Biome provider', async () => {
    const projectDir = tempProjectCreate();
    createdDirs.push(projectDir);
    const { biomeBin, tracePath } = mockBiomeScriptCreate(projectDir);

    const biomeRule = pluginRuleNew({
      id: 'mock-biome',
      capabilities: {
        lintProviders: [
          {
            platform: 'biome',
            languages: ['typescript', 'tsx', 'javascript', 'jsx'],
            config: { biomeBin },
          },
        ],
      },
    });

    const treeOnlyRule = pluginRuleNew({
      id: 'tree-only',
      capabilities: {
        treeCheckProvider: treeCheckProviderNew({
          languages: ['typescript'],
          check: () => [],
        }),
      },
    });

    pluginModuleRegister(TEST_PLUGIN_SCOPED_ID, { default: [biomeRule, treeOnlyRule] });

    fs.mkdirSync(path.join(projectDir, 'src', 'biome'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src', 'other'), { recursive: true });

    const biomeFile = path.join(projectDir, 'src', 'biome', 'app.ts');
    const otherFile = path.join(projectDir, 'src', 'other', 'other.ts');
    fs.writeFileSync(biomeFile, 'export const bad = left == right;\n', 'utf8');
    fs.writeFileSync(otherFile, 'export const bad = left == right;\n', 'utf8');

    const config: CodepolConfig = {
      targets: {
        biomeOnly: {
          language: 'typescript',
          files: ['src/biome/**/*.ts'],
        },
        otherOnly: {
          language: 'typescript',
          files: ['src/other/**/*.ts'],
        },
      },
      plugins: [{ id: TEST_PLUGIN_SCOPED_ID, source: { kind: 'builtin' } }],
      rules: [
        {
          ruleId: `${TEST_PLUGIN_SCOPED_ID}/mock-biome`,
          targets: ['biomeOnly'],
          providers: ['biome'],
        },
        {
          ruleId: `${TEST_PLUGIN_SCOPED_ID}/tree-only`,
          targets: ['otherOnly'],
        },
      ],
    };

    const originalEnv = process.env.MOCK_BIOME_TRACE;
    process.env.MOCK_BIOME_TRACE = tracePath;

    try {
      const result = await policyCheck({
        config,
        configPath: path.join(projectDir, 'codepol.toml'),
        eslintConfigPath: path.join(projectDir, 'eslint.config.mjs'),
        fix: false,
        cwd: projectDir,
      });

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].filePath).toBe(biomeFile);

      const traceLines = fs.readFileSync(tracePath, 'utf8').trim().split('\n');
      expect(traceLines).toHaveLength(1);
      const args = JSON.parse(traceLines[0]) as string[];
      expect(args).toContain(biomeFile);
      expect(args).not.toContain(otherFile);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MOCK_BIOME_TRACE;
      } else {
        process.env.MOCK_BIOME_TRACE = originalEnv;
      }
    }
  });

  it('runs biome once per distinct Biome provider config group', async () => {
    const projectDir = tempProjectCreate();
    createdDirs.push(projectDir);
    const { biomeBin, tracePath } = mockBiomeScriptCreate(projectDir);

    const biomeRuleA = pluginRuleNew({
      id: 'mock-biome-a',
      capabilities: {
        lintProviders: [
          {
            platform: 'biome',
            languages: ['typescript'],
            config: { biomeBin, extraArgs: ['--foo'] },
          },
        ],
      },
    });

    const biomeRuleB = pluginRuleNew({
      id: 'mock-biome-b',
      capabilities: {
        lintProviders: [
          {
            platform: 'biome',
            languages: ['typescript'],
            config: { biomeBin, extraArgs: ['--bar'] },
          },
        ],
      },
    });

    pluginModuleRegister(TEST_PLUGIN_MULTI_ID, { default: [biomeRuleA, biomeRuleB] });

    fs.mkdirSync(path.join(projectDir, 'src', 'a'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src', 'b'), { recursive: true });

    const fileA = path.join(projectDir, 'src', 'a', 'a.ts');
    const fileB = path.join(projectDir, 'src', 'b', 'b.ts');
    fs.writeFileSync(fileA, 'export const bad = left == right;\n', 'utf8');
    fs.writeFileSync(fileB, 'export const bad = left == right;\n', 'utf8');

    const config: CodepolConfig = {
      targets: {
        targetA: { language: 'typescript', files: ['src/a/**/*.ts'] },
        targetB: { language: 'typescript', files: ['src/b/**/*.ts'] },
      },
      plugins: [{ id: TEST_PLUGIN_MULTI_ID, source: { kind: 'builtin' } }],
      rules: [
        {
          ruleId: `${TEST_PLUGIN_MULTI_ID}/mock-biome-a`,
          targets: ['targetA'],
          providers: ['biome'],
        },
        {
          ruleId: `${TEST_PLUGIN_MULTI_ID}/mock-biome-b`,
          targets: ['targetB'],
          providers: ['biome'],
        },
      ],
    };

    const originalEnv = process.env.MOCK_BIOME_TRACE;
    process.env.MOCK_BIOME_TRACE = tracePath;

    try {
      const result = await policyCheck({
        config,
        configPath: path.join(projectDir, 'codepol.toml'),
        eslintConfigPath: path.join(projectDir, 'eslint.config.mjs'),
        fix: false,
        cwd: projectDir,
      });

      expect(result.violations).toHaveLength(2);

      const traceLines = fs.readFileSync(tracePath, 'utf8').trim().split('\n');
      expect(traceLines).toHaveLength(2);
      const allArgs = traceLines.map(line => JSON.parse(line) as string[]);
      const filesPerRun = allArgs.map(args => args.filter(a => a.endsWith('.ts')));
      for (const tsFiles of filesPerRun) {
        expect(tsFiles).toHaveLength(1);
      }
      expect([...new Set(filesPerRun.flat())].sort()).toEqual([fileA, fileB].sort());
      expect(allArgs.some(a => a.includes('--foo'))).toBe(true);
      expect(allArgs.some(a => a.includes('--bar'))).toBe(true);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MOCK_BIOME_TRACE;
      } else {
        process.env.MOCK_BIOME_TRACE = originalEnv;
      }
    }
  });

  it('throws when the same rule declares conflicting Biome provider configs', async () => {
    const projectDir = tempProjectCreate();
    createdDirs.push(projectDir);
    const { biomeBin } = mockBiomeScriptCreate(projectDir);

    const conflictRule = pluginRuleNew({
      id: 'conflict-biome',
      capabilities: {
        lintProviders: [
          {
            platform: 'biome',
            languages: ['typescript'],
            config: { biomeBin, configPath: './a.json' },
          },
          {
            platform: 'biome',
            languages: ['typescript'],
            config: { biomeBin, configPath: './b.json' },
          },
        ],
      },
    });

    pluginModuleRegister(TEST_PLUGIN_CONFLICT_ID, { default: [conflictRule] });

    const config: CodepolConfig = {
      targets: {
        src: { language: 'typescript', files: ['src/**/*.ts'] },
      },
      plugins: [{ id: TEST_PLUGIN_CONFLICT_ID, source: { kind: 'builtin' } }],
      rules: [
        {
          ruleId: `${TEST_PLUGIN_CONFLICT_ID}/conflict-biome`,
          targets: ['src'],
          providers: ['biome'],
        },
      ],
    };

    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    await expect(
      policyCheck({
        config,
        configPath: path.join(projectDir, 'codepol.toml'),
        eslintConfigPath: path.join(projectDir, 'eslint.config.mjs'),
        fix: false,
        cwd: projectDir,
      }),
    ).rejects.toThrow(/Conflicting Biome lint provider configs/);
  });
});

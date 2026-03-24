import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PolicyFile } from '@codepol/core';
import {
  isErr,
  langAdd,
  parserInit,
  policyViolationsGetFromDir,
  pluginBuiltinRegister,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

// ============================================================================
// Helpers
// ============================================================================

/** Logger args shared across all logger rule tests. */
const loggerArgs = {
  logger: {
    identifier: 'logger',
    enterMethod: 'enter',
    exitMethod: 'exit',
    import: { module: './logger', named: 'logger' },
  },
};

const builtinPlugin = {
  id: '@codepol/plugin',
  source: { kind: 'builtin' as const },
};

/**
 * Creates a temp project directory for a logger rule check.
 * Writes the given source files and a standard logger mock, then returns
 * the dir path and a policy targeting those files.
 */
function tempProjectForLoggerCheck(
  sources: Record<string, string>
): { dir: string; policy: PolicyFile } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-logger-'));
  const fileNames = Object.keys(sources);

  for (const [name, content] of Object.entries(sources)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }

  const policy: PolicyFile = {
    plugins: [builtinPlugin],
    exclude: [],
    targets: {
      src: {
        language: 'typescript',
        files: fileNames,
      },
    },
    rules: [
      {
        id: 'function-logging',
        ruleId: '@codepol/plugin/require-logger-enter-exit',
        description: 'Ensure functions include logger enter/exit',
        args: loggerArgs,
        targets: ['src'],
      },
    ],
  };

  return { dir, policy };
}

// ============================================================================
// Tests
// ============================================================================

describe('tree-sitter policy check', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);
  });

  it('finds missing logger instrumentation while ignoring already instrumented files', async () => {
    const policy: PolicyFile = {
      plugins: [builtinPlugin],
      exclude: [],
      targets: {
        'test-fixtures': {
          language: 'typescript',
          files: ['tests/fixtures/ts/**/*.ts'],
          exclude: ['tests/fixtures/ts/logger.ts'],
        },
      },
      rules: [
        {
          id: 'function-logging',
          ruleId: '@codepol/plugin/require-logger-enter-exit',
          description: 'Ensure functions include logger enter/exit',
          args: loggerArgs,
          targets: ['test-fixtures'],
        },
      ],
    };

    const violationsResult = await policyViolationsGetFromDir(policy, process.cwd());
    if ('Err' in violationsResult) {
      console.error(violationsResult.Err);
    }
    expect('Err' in violationsResult).toBe(false);
    const violations = violationsResult.Ok!;
    const violationFiles = violations.map(violation => path.relative(process.cwd(), violation.filePath));

    expect(violationFiles).toContain(path.join('tests', 'fixtures', 'ts', 'missing.ts'));
    expect(violationFiles).toContain(path.join('tests', 'fixtures', 'ts', 'arrow.ts'));
    expect(violationFiles).not.toContain(path.join('tests', 'fixtures', 'ts', 'already.ts'));
  });

  describe('additional function types', () => {
    let tempDirs: string[] = [];

    afterAll(() => {
      for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects missing logger in method definitions', async () => {
      const { dir, policy } = tempProjectForLoggerCheck({
        'methods.ts': `export class Service {
  handle() {
    return 'done';
  }
  process() {
    return 42;
  }
}
`,
      });
      tempDirs.push(dir);

      const result = await policyViolationsGetFromDir(policy, dir);
      expect(isErr(result)).toBe(false);

      const violations = result.Ok!;
      const messages = violations.map(v => v.message);
      expect(violations.length).toBeGreaterThanOrEqual(2);
      expect(messages.some(m => m.includes('handle'))).toBe(true);
      expect(messages.some(m => m.includes('process'))).toBe(true);
    });

    it('detects missing logger in function expressions', async () => {
      const { dir, policy } = tempProjectForLoggerCheck({
        'expr.ts': `export const doWork = function namedExpr() {
  return 'work';
};
`,
      });
      tempDirs.push(dir);

      const result = await policyViolationsGetFromDir(policy, dir);
      expect(isErr(result)).toBe(false);

      const violations = result.Ok!;
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('namedExpr');
    });

    it('detects missing logger in async functions', async () => {
      const { dir, policy } = tempProjectForLoggerCheck({
        'async.ts': `export async function fetchData() {
  return await Promise.resolve(42);
}
`,
      });
      tempDirs.push(dir);

      const result = await policyViolationsGetFromDir(policy, dir);
      expect(isErr(result)).toBe(false);

      const violations = result.Ok!;
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('fetchData');
    });

    it('detects missing logger in generator functions', async () => {
      const { dir, policy } = tempProjectForLoggerCheck({
        'gen.ts': `export function* generate() {
  yield 1;
  yield 2;
}
`,
      });
      tempDirs.push(dir);

      const result = await policyViolationsGetFromDir(policy, dir);
      expect(isErr(result)).toBe(false);

      const violations = result.Ok!;
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('generate');
    });

    it('detects missing logger in empty function body', async () => {
      const { dir, policy } = tempProjectForLoggerCheck({
        'empty.ts': `export function noop() {}
`,
      });
      tempDirs.push(dir);

      const result = await policyViolationsGetFromDir(policy, dir);
      expect(isErr(result)).toBe(false);

      const violations = result.Ok!;
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('noop');
      expect(violations[0].message).toContain('logger.enter');
      expect(violations[0].message).toContain('logger.exit');
    });
  });

  describe('exclude patterns', () => {
    let tempDirs: string[] = [];

    afterAll(() => {
      for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('respects target-level exclude patterns', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-exclude-'));
      tempDirs.push(dir);

      fs.writeFileSync(path.join(dir, 'app.ts'), 'export function appFn() { return 1; }', 'utf8');
      fs.writeFileSync(path.join(dir, 'generated.ts'), 'export function genFn() { return 2; }', 'utf8');

      const policy: PolicyFile = {
        plugins: [builtinPlugin],
        exclude: [],
        targets: {
          src: {
            language: 'typescript',
            files: ['*.ts'],
            exclude: ['generated.ts'],
          },
        },
        rules: [
          {
            id: 'function-logging',
            ruleId: '@codepol/plugin/require-logger-enter-exit',
            description: 'Ensure functions include logger enter/exit',
            args: loggerArgs,
            targets: ['src'],
          },
        ],
      };

      const result = await policyViolationsGetFromDir(policy, dir);
      expect(isErr(result)).toBe(false);

      const violations = result.Ok!;
      const violationFiles = violations.map(v => path.basename(v.filePath));
      expect(violationFiles).toContain('app.ts');
      expect(violationFiles).not.toContain('generated.ts');
    });

    it('respects global policy-level exclude patterns', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-exclude-'));
      tempDirs.push(dir);

      fs.writeFileSync(path.join(dir, 'app.ts'), 'export function appFn() { return 1; }', 'utf8');
      fs.writeFileSync(path.join(dir, 'generated.ts'), 'export function genFn() { return 2; }', 'utf8');

      const policy: PolicyFile = {
        plugins: [builtinPlugin],
        exclude: ['generated.ts'],
        targets: {
          src: {
            language: 'typescript',
            files: ['*.ts'],
          },
        },
        rules: [
          {
            id: 'function-logging',
            ruleId: '@codepol/plugin/require-logger-enter-exit',
            description: 'Ensure functions include logger enter/exit',
            args: loggerArgs,
            targets: ['src'],
          },
        ],
      };

      const result = await policyViolationsGetFromDir(policy, dir);
      expect(isErr(result)).toBe(false);

      const violations = result.Ok!;
      const violationFiles = violations.map(v => path.basename(v.filePath));
      expect(violationFiles).toContain('app.ts');
      expect(violationFiles).not.toContain('generated.ts');
    });
  });
});

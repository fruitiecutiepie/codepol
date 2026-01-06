import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { esbuildPluginNew } from '@codepol/esbuild-plugin';

describe('esbuild policy plugin', () => {
  it('fails the build when policy violations are present and succeeds after fixes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'policy-'));
    const policyPath = path.join(dir, 'policy.json');
    const loggerPath = path.join(dir, 'logger.ts');
    const entryPath = path.join(dir, 'index.ts');
    const outfile = path.join(dir, 'out.js');

    writeFileSync(
      policyPath,
      JSON.stringify(
        {
          rules: [
            {
              id: 'function-logging',
              description: 'Ensure functions include logger enter/exit',
              language: 'typescript',
              files: ['index.ts'],
            },
          ],
          logger: {
            identifier: 'logger',
            enterMethod: 'enter',
            exitMethod: 'exit',
            import: {
              module: './logger',
              named: 'logger',
            },
          },
        },
        null,
        2,
      ),
    );

    writeFileSync(
      loggerPath,
      `export const logger = {
  enter(payload: unknown) { return payload; },
  exit(payload: unknown) { return payload; },
};
`,
    );

    writeFileSync(entryPath, 'export const f = () => 1;');

    const failure = await build({
      absWorkingDir: dir,
      entryPoints: [entryPath],
      outfile,
      bundle: false,
      logLevel: 'silent',
      plugins: [esbuildPluginNew({ policyPath: 'policy.json', eslintConfigPath: path.resolve('.eslintrc.cjs') })],
    }).catch(error => error);

    expect(failure).toBeInstanceOf(Error);

    writeFileSync(
      entryPath,
      `import { logger } from './logger';
export const f = () => {
  logger.enter({});
  try {
    return 1;
  } finally {
    logger.exit({});
  }
};
`,
    );

    const result = await build({
      absWorkingDir: dir,
      entryPoints: [entryPath],
      outfile,
      bundle: false,
      logLevel: 'silent',
      plugins: [esbuildPluginNew({ policyPath: 'policy.json', eslintConfigPath: path.resolve('.eslintrc.cjs') })],
    });

    expect(result.errors.length).toBe(0);
  });
});

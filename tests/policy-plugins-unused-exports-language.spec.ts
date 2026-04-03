import { describe, expect, it } from 'vitest';
import { policyPluginsGet, isErr } from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

describe('no-unused-exports language support', () => {
  it('rejects python targets because treeCheckProvider is JS/TS-only', async () => {
    const { pluginBuiltinRegister } = await import('@codepol/core');
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

    const policy = {
      targets: {
        py: { language: 'python' as const, files: ['**/*.py'] },
      },
      plugins: [{ id: '@codepol/plugin', source: { kind: 'builtin' as const } }],
      rules: [
        {
          ruleId: '@codepol/plugin/no-unused-exports',
          targets: ['py'],
        },
      ],
    };

    const result = await policyPluginsGet(policy, process.cwd(), {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.Err).toContain('does not support language');
      expect(result.Err).toContain('python');
    }
  });
});

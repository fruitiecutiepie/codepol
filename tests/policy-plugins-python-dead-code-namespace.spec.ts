import { describe, expect, it } from 'vitest';
import { isOk, pluginBuiltinRegister, policyPluginsGet } from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

describe('@codepol/plugin python-dead-code', () => {
  it('loads the python dead-code rule under the builtin plugin namespace', async () => {
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

    const policy = {
      targets: {
        py: { language: 'python' as const, files: ['**/*.py'] },
      },
      plugins: [{ id: '@codepol/plugin', source: { kind: 'builtin' as const } }],
      rules: [
        {
          ruleId: '@codepol/plugin/python-dead-code',
          targets: ['py'],
        },
      ],
    };

    const result = await policyPluginsGet(policy, process.cwd(), {});
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.Ok.has('@codepol/plugin/python-dead-code')).toBe(true);
    }
  });
});

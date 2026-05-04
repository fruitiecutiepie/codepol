import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOk } from '../result/result';
import type { PolicyFile, PolicyRule, PolicyRuleTarget } from './policyTypes';

const fastGlobMock = vi.fn();

vi.mock('fast-glob', () => ({
  default: fastGlobMock,
}));

function policyRuleTargetNew(
  overrides: Partial<PolicyRuleTarget> & { language: string; files: string[] },
): PolicyRuleTarget {
  return { ...overrides };
}

function policyRuleNew(
  overrides: Partial<PolicyRule> & { ruleId: string; targets: string[] },
): PolicyRule {
  return { ...overrides };
}

function policyFileNew(
  overrides: Partial<PolicyFile> & {
    targets: PolicyFile['targets'];
    rules: PolicyFile['rules'];
  },
): PolicyFile {
  return { ...overrides };
}

describe('ruleMatchesGet fast-glob behavior', () => {
  beforeEach(() => {
    fastGlobMock.mockReset();
  });

  it('reuses identical target scans and applies bounded scandir concurrency', async () => {
    fastGlobMock.mockResolvedValue([
      '/workspace/src/a.ts',
      '/workspace/src/b.tsx',
    ]);

    const { ruleMatchesGet } = await import('./policyGet');
    const sharedTarget = policyRuleTargetNew({
      language: 'typescript',
      files: ['src/**/*.{ts,tsx}'],
    });
    const policy = policyFileNew({
      targets: {
        shared: sharedTarget,
      },
      rules: [
        policyRuleNew({ ruleId: 'rule-a', targets: ['shared'] }),
        policyRuleNew({ ruleId: 'rule-b', targets: ['shared'] }),
      ],
    });

    const matchesR = await ruleMatchesGet(policy, '/workspace');
    expect(isOk(matchesR)).toBe(true);
    if (!isOk(matchesR)) return;
    const matches = matchesR.Ok;

    expect(matches).toHaveLength(2);
    expect(matches[0]?.files).toEqual(['/workspace/src/a.ts', '/workspace/src/b.tsx']);
    expect(matches[1]?.files).toEqual(['/workspace/src/a.ts', '/workspace/src/b.tsx']);
    expect(fastGlobMock).toHaveBeenCalledTimes(1);
    expect(fastGlobMock).toHaveBeenCalledWith(['src/**/*.{ts,tsx}'], {
      cwd: '/workspace',
      absolute: true,
      ignore: [],
      onlyFiles: true,
      concurrency: 8,
    });
  });
});

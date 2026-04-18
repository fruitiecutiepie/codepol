import { describe, expect, it } from 'vitest';
import { Ok } from '@codepol/core';
import type {
  PluginRule,
  PolicyFile,
  PolicyPluginsMap,
  PolicyRule,
  PolicyRuleFixMode,
} from '@codepol/core';
import { ruleFixModeResolverCreate } from './fixMode';

type PluginCapabilityShape = {
  hasFixProvider?: boolean;
  hasTreeCheckProvider?: boolean;
};

function pluginsMapBuild(
  entries: Array<{ ruleId: string } & PluginCapabilityShape>,
): PolicyPluginsMap {
  const map: PolicyPluginsMap = new Map();
  for (const entry of entries) {
    const pluginRule: PluginRule['pluginRule'] = {
      id: entry.ruleId,
      capabilities: {
        ...(entry.hasFixProvider
          ? {
              fixProvider: {
                apply() {},
              },
            }
          : {}),
        ...(entry.hasTreeCheckProvider
          ? {
              treeCheckProvider: {
                check() {
                  return Ok([]);
                },
              },
            }
          : {}),
      },
    } as PluginRule['pluginRule'];
    map.set(entry.ruleId, { pluginRule });
  }
  return map;
}

function policyBuild(rules: PolicyRule[]): PolicyFile {
  return {
    targets: {},
    rules,
  };
}

function rule(
  ruleId: string,
  overrides: Partial<PolicyRule> = {},
): PolicyRule {
  return {
    ruleId,
    targets: [],
    ...overrides,
  };
}

describe('ruleFixModeResolverCreate', () => {
  it('defaults to "manual" when the rule has a fix surface and no explicit mode', () => {
    const policy = policyBuild([rule('@codepol/plugin/foo')]);
    const plugins = pluginsMapBuild([
      { ruleId: '@codepol/plugin/foo', hasFixProvider: true },
    ]);

    const resolver = ruleFixModeResolverCreate(policy, plugins);
    expect(resolver.ruleFixModeGet('@codepol/plugin/foo')).toBe<PolicyRuleFixMode>('manual');
    expect(resolver.onSaveRuleIdsList()).toEqual([]);
    expect(resolver.fixEligibleRuleIdsList()).toEqual(['@codepol/plugin/foo']);
  });

  it('honors an explicit "on-save" declaration', () => {
    const policy = policyBuild([
      rule('@codepol/plugin/foo', { fix: 'on-save' }),
    ]);
    const plugins = pluginsMapBuild([
      { ruleId: '@codepol/plugin/foo', hasFixProvider: true },
    ]);

    const resolver = ruleFixModeResolverCreate(policy, plugins);
    expect(resolver.ruleFixModeGet('@codepol/plugin/foo')).toBe('on-save');
    expect(resolver.onSaveRuleIdsList()).toEqual(['@codepol/plugin/foo']);
  });

  it('treats `severity = "off"` as `fix = "never"` regardless of declared mode', () => {
    const policy = policyBuild([
      rule('@codepol/plugin/foo', { fix: 'on-save', severity: 'off' }),
    ]);
    const plugins = pluginsMapBuild([
      { ruleId: '@codepol/plugin/foo', hasFixProvider: true },
    ]);

    const resolver = ruleFixModeResolverCreate(policy, plugins);
    expect(resolver.ruleFixModeGet('@codepol/plugin/foo')).toBe('never');
    expect(resolver.onSaveRuleIdsList()).toEqual([]);
    expect(resolver.fixEligibleRuleIdsList()).toEqual([]);
  });

  it('treats rules without any fix surface as `never`', () => {
    const policy = policyBuild([
      rule('@codepol/plugin/foo', { fix: 'on-save' }),
    ]);
    const plugins = pluginsMapBuild([
      { ruleId: '@codepol/plugin/foo' },
    ]);

    const resolver = ruleFixModeResolverCreate(policy, plugins);
    expect(resolver.ruleFixModeGet('@codepol/plugin/foo')).toBe('never');
  });

  it('treats tree-check providers as a fix surface', () => {
    const policy = policyBuild([rule('@codepol/plugin/tc')]);
    const plugins = pluginsMapBuild([
      { ruleId: '@codepol/plugin/tc', hasTreeCheckProvider: true },
    ]);

    const resolver = ruleFixModeResolverCreate(policy, plugins);
    expect(resolver.ruleFixModeGet('@codepol/plugin/tc')).toBe('manual');
  });

  it('returns `never` for unknown rule ids', () => {
    const policy = policyBuild([]);
    const plugins = pluginsMapBuild([]);
    const resolver = ruleFixModeResolverCreate(policy, plugins);
    expect(resolver.ruleFixModeGet('@codepol/plugin/missing')).toBe('never');
  });

  it('preserves policy declaration order in onSaveRuleIdsList', () => {
    const policy = policyBuild([
      rule('@codepol/plugin/b', { fix: 'on-save' }),
      rule('@codepol/plugin/a', { fix: 'on-save' }),
      rule('@codepol/plugin/c', { fix: 'manual' }),
    ]);
    const plugins = pluginsMapBuild([
      { ruleId: '@codepol/plugin/a', hasFixProvider: true },
      { ruleId: '@codepol/plugin/b', hasFixProvider: true },
      { ruleId: '@codepol/plugin/c', hasFixProvider: true },
    ]);

    const resolver = ruleFixModeResolverCreate(policy, plugins);
    expect(resolver.onSaveRuleIdsList()).toEqual([
      '@codepol/plugin/b',
      '@codepol/plugin/a',
    ]);
  });
});

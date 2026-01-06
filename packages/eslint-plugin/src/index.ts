/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint plugin adapter for codepol plugins.
 */

import loggerPlugin, { clearPolicyCache, rulePlugins as loggerRulePlugins } from '@codepol/plugin';

const collectedRules: Record<string, unknown> = {};
for (const rulePlugin of loggerRulePlugins) {
  const provider = rulePlugin.capabilities?.eslintRuleProvider ?? rulePlugin.eslintRuleProvider;
  if (!provider) {
    continue;
  }
  Object.assign(collectedRules, provider.rules);
}

const plugin = { rules: collectedRules };

export default plugin;
export const rules = plugin.rules;
export { clearPolicyCache, loggerPlugin };

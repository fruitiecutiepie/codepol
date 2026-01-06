/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint plugin adapter for codepol plugins.
 */

import loggerPlugin, { clearPolicyCache, rulePlugins as loggerRulePlugins } from '@codepol/plugin-logger';

const rules: Record<string, unknown> = {};
for (const rulePlugin of loggerRulePlugins) {
  const provider = rulePlugin.capabilities?.eslintRuleProvider ?? rulePlugin.eslintRuleProvider;
  if (!provider) {
    continue;
  }
  Object.assign(rules, provider.rules);
}

const plugin = { rules };

export default plugin;
export const rules = plugin.rules;
export { clearPolicyCache, loggerPlugin };

/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint plugin adapter for codepol plugins.
 */

import loggerPlugin, { clearPolicyCache, rules as loggerRules } from '@codepol/plugin-logger';

const plugin = {
  rules: loggerRules,
};

export default plugin;
export const rules = plugin.rules;
export { clearPolicyCache, loggerPlugin };

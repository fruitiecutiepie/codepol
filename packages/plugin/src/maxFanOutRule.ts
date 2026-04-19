import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { maxFanOutCheck } from './maxFanOutCheck';

/**
 * Built-in architecture rule: cap the importee count of any file.
 * Configure via {@link MaxFanOutArgs}.
 */
export const maxFanOutRule: CodepolPluginRule = pluginRuleNew({
  id: 'max-fan-out',
  capabilities: {
    architectureCheckProvider: {
      check: maxFanOutCheck,
    },
  },
});

import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { maxFanInCheck } from './maxFanInCheck';

/**
 * Built-in architecture rule: cap the importer count of any file.
 * Configure via {@link MaxFanInArgs}. Useful for guarding against
 * "god module" growth in shared libraries.
 */
export const maxFanInRule: CodepolPluginRule = pluginRuleNew({
  id: 'max-fan-in',
  capabilities: {
    architectureCheckProvider: {
      check: maxFanInCheck,
    },
  },
});

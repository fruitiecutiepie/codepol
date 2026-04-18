import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { noLayerViolationCheck } from './noLayerViolationCheck';

/**
 * Built-in architecture rule: enforce import direction between layers.
 *
 * Layers are declared via `args.layers` as a map from layer name to a
 * config block with `files`, optional `allows`, and optional `denies`.
 * See {@link NoLayerViolationArgs} for the full schema.
 */
export const noLayerViolationRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-layer-violation',
  capabilities: {
    architectureCheckProvider: {
      check: noLayerViolationCheck,
    },
  },
});

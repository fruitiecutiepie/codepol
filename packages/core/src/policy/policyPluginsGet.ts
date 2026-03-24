import type {
  PolicyFile,
  CodepolPluginRule,
  PluginRule,
  FixProvider,
} from './policyTypes';
import { Result, Ok, Err, isErr } from '../result/result';
import { policyRuleTargetsResolve } from './policyGet';
import {
  processPluginDescribeGet,
  processPluginRuleCheck,
  processPluginRuleFix,
  type ProcessPluginRuntimeContext,
} from './policyPluginProcess';
import { pluginRuleNew } from './policyTypes';

export type PolicyPluginsMap = Map<string, PluginRule>;
export type PolicyPluginsLoadOptions = {
  configPath?: string;
};

/**
 * Built-in rule plugins keyed by stable plugin identifier.
 */
const builtinPlugins = new Map<string, CodepolPluginRule[]>();

/**
 * Normalize built-in rule plugin exports to a plain array of `CodepolPluginRule`.
 */
function pluginRulesNormalize(input: unknown): CodepolPluginRule[] {
  if (Array.isArray(input)) {
    return input as CodepolPluginRule[];
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.pluginRules)) {
      return obj.pluginRules as CodepolPluginRule[];
    }
    if (Array.isArray(obj.default)) {
      return obj.default as CodepolPluginRule[];
    }
    if (
      obj.__esModule &&
      obj.default &&
      typeof obj.default === 'object' &&
      Array.isArray((obj.default as Record<string, unknown>).default)
    ) {
      return (obj.default as { default: CodepolPluginRule[] }).default;
    }
  }
  throw new Error(
    'Expected built-in plugin rules as an array or as an object with a default/pluginRules export.'
  );
}

/**
 * Registers built-in rule plugins for transport-neutral resolution.
 */
export function pluginBuiltinRegister(pluginId: string, pluginRules: CodepolPluginRule[] | unknown): void {
  builtinPlugins.set(pluginId, pluginRulesNormalize(pluginRules));
}

/**
 * Backward-compatible alias for the older Node-module-oriented registry name.
 */
export function pluginModuleRegister(moduleSpecifier: string, moduleExports: unknown): void {
  pluginBuiltinRegister(moduleSpecifier, moduleExports);
}

/**
 * Resolves a rule ID by prefixing with module specifier if not already namespaced.
 * Plugin authors can define short IDs (e.g., "require-logger-enter-exit") and
 * codepol will namespace them (e.g., "@codepol/plugin/require-logger-enter-exit").
 */
function ruleIDGetWithNamespace(id: string, moduleSpecifier: string): string {
  if (id.includes('/')) return id;
  return `${moduleSpecifier}/${id}`;
}

/**
 * Looks up a plugin by rule ID, supporting both full and short IDs.
 * Short IDs are matched by suffix (e.g., "require-logger-enter-exit" matches
 * "@codepol/plugin/require-logger-enter-exit").
 * @returns The plugin and resolved ID, or undefined if not found or ambiguous
 */
export function pluginGetForRule(
  pluginsMap: PolicyPluginsMap,
  ruleId: string
): { plugin: PluginRule; resolvedId: string } | undefined {
  // Try exact match first
  const exactMatch = pluginsMap.get(ruleId);
  if (exactMatch) {
    return { plugin: exactMatch, resolvedId: ruleId };
  }

  // If the ID doesn't contain '/', try suffix matching
  if (!ruleId.includes('/')) {
    const suffix = `/${ruleId}`;
    const matches: { plugin: PluginRule; resolvedId: string }[] = [];
    for (const [key, plugin] of pluginsMap) {
      if (key.endsWith(suffix)) {
        matches.push({ plugin, resolvedId: key });
      }
    }
    if (matches.length === 1) {
      return matches[0];
    }
    // Ambiguous or no match - return undefined
  }

  return undefined;
}

function processPluginRulesCreate(runtimeContext: ProcessPluginRuntimeContext): CodepolPluginRule[] {
  const described = processPluginDescribeGet(runtimeContext);
  return described.rules.map((descriptor) => {
    const fixProvider: FixProvider | undefined = descriptor.hasFixProvider
      ? {
          apply: (context) => {
            processPluginRuleFix(runtimeContext, descriptor.id, context);
          },
        }
      : undefined;

    return pluginRuleNew({
      id: descriptor.id,
      capabilities: {
        treeCheckProvider: {
          languages: descriptor.languages,
          check: (rule, context) => {
            try {
              const violations = processPluginRuleCheck(runtimeContext, descriptor.id, rule, context);
              return Ok(violations);
            } catch (error) {
              return Err(error instanceof Error ? error.message : String(error));
            }
          },
        },
        fixProvider,
        requiresProjectIndex: descriptor.requiresProjectIndex,
      },
    });
  });
}

function pluginRulesResolve(
  runtimeContext: ProcessPluginRuntimeContext,
): Result<CodepolPluginRule[], string> {
  if (runtimeContext.declaration.source.kind === 'builtin') {
    const builtin = builtinPlugins.get(runtimeContext.declaration.id);
    if (!builtin) {
      return Err(
        `Builtin plugin ${runtimeContext.declaration.id} is not registered. ` +
          'Register it with pluginBuiltinRegister() before loading the config.'
      );
    }
    return Ok(builtin);
  }

  if (runtimeContext.declaration.source.kind === 'process') {
    try {
      return Ok(processPluginRulesCreate(runtimeContext));
    } catch (error) {
      return Err(error instanceof Error ? error.message : String(error));
    }
  }

  return Err(`Unsupported plugin source for ${runtimeContext.declaration.id}.`);
}

/**
 * Loads plugins declared in the policy into a map keyed by plugin rule id.
 * @returns Result containing the plugins map or an error message
 */
export async function policyPluginsGet(
  policy: PolicyFile,
  cwd: string,
  options: PolicyPluginsLoadOptions = {}
): Promise<Result<PolicyPluginsMap, string>> {
  const declarations = policy.plugins ?? [];
  const pluginsMapGet = new Map<string, PluginRule>();

  for (const declaration of declarations) {
    const runtimeContext: ProcessPluginRuntimeContext = {
      declaration,
      cwd,
      configPath: options.configPath,
    };
    const pluginRulesResult = pluginRulesResolve(runtimeContext);
    if (isErr(pluginRulesResult)) {
      return Err(pluginRulesResult.Err);
    }
    const pluginRules = pluginRulesResult.Ok;

    for (const pluginRule of pluginRules) {
      if (!pluginRule.id) {
         return Err(`Rule plugin from ${declaration.id} missing id.`);
      }
      if (pluginRule.id.includes('/')) {
        return Err(
          `Rule plugin id "${pluginRule.id}" from ${declaration.id} must not contain '/'. ` +
          `The '/' character is reserved for namespacing (e.g., "@scope/plugin/rule-id").`
        );
      }
      
      const resolvedId = ruleIDGetWithNamespace(pluginRule.id, declaration.id);

      if (pluginsMapGet.has(resolvedId)) {
        return Err(`Duplicate plugin rule id detected: ${resolvedId}.`);
      }

      const namespacedPluginRule = {
        ...pluginRule,
        id: resolvedId
      };

      pluginsMapGet.set(resolvedId, {
        pluginRule: namespacedPluginRule
      });
    }
  }

  // Validate that all policy rules have a matching plugin
  for (const rule of policy.rules) {
    const ruleId = rule.ruleId;
    if (!ruleId) {
        return Err(`Policy rule missing 'ruleId'.`);
    }

    const lookup = pluginGetForRule(pluginsMapGet, ruleId);
    if (!lookup) {
      return Err(`No plugin registered for rule type ${ruleId}.`);
    }
    const { plugin, resolvedId } = lookup;

    const treeCheckProvider = plugin.pluginRule.capabilities.treeCheckProvider;
    if (treeCheckProvider) {
      const targets = policyRuleTargetsResolve(rule, policy);
      for (const target of targets) {
        if (!treeCheckProvider.languages.includes(target.language)) {
          return Err(`Plugin ${resolvedId} does not support language ${target.language} for rule ${rule.id || ruleId}.`);
        }
      }
    }
  }

  return Ok(pluginsMapGet);
}

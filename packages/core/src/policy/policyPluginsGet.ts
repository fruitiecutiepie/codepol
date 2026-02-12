import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  PolicyFile,
  PolicyPluginDeclaration,
  CodepolPluginRule,
  PluginRule,
} from './policyTypes';
import { Result, Ok, Err } from '../result/result';
import { policyRuleTargetsResolve } from './policyGet';

export type PolicyPluginsMap = Map<string, PluginRule>;

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

/**
 * Loads plugins declared in the policy into a map keyed by plugin rule id.
 * @returns Result containing the plugins map or an error message
 */
export async function policyPluginsGet(
  policy: PolicyFile,
  cwd: string
): Promise<Result<PolicyPluginsMap, string>> {
  let declarations: PolicyPluginDeclaration[] = [];
  if (policy.plugins !== undefined) {
    declarations = policy.plugins;
  }
  const pluginsMapGet = new Map<string, PluginRule>();

  // Create a require function that resolves from consumer's project context
  const requireFromCwd = createRequire(path.join(cwd, 'package.json'));

  for (const declaration of declarations) {
    const moduleSpecifier = typeof declaration === 'string' ? declaration : declaration.module;
    
    let moduleSource: string;
    if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
      // Relative or absolute paths resolve from cwd
      moduleSource = pathToFileURL(path.resolve(cwd, moduleSpecifier)).href;
    } else {
      // Bare package specifiers resolve from consumer's node_modules
      try {
        moduleSource = pathToFileURL(requireFromCwd.resolve(moduleSpecifier)).href;
      } catch (e) {
        return Err(`Failed to resolve plugin module ${moduleSpecifier}: ${e}`);
      }
    }
    
    let moduleLoaded;
    try {
      moduleLoaded = await import(moduleSource);
    } catch (e) {
      return Err(`Failed to load plugin module ${moduleSpecifier}: ${e}`);
    }

    // Handle CommonJS/ESM interop: when dynamically importing a CommonJS module
    // that uses TypeScript's `export default`, Node.js wraps the entire `exports`
    // object as the default. Check for nested `default` in __esModule modules.
    //
    // TODO: Remove this workaround by publishing @codepol/plugin as dual ESM+CJS package.
    let pluginExported = moduleLoaded.default;
    if (
      pluginExported &&
      typeof pluginExported === 'object' &&
      pluginExported.__esModule &&
      'default' in pluginExported
    ) {
      pluginExported = pluginExported.default;
    }
    if (!pluginExported) {
      return Err(`Module ${moduleSpecifier} does not have a default export.`);
    }

    let pluginRules: CodepolPluginRule[];
    try {
      // pluginRulesNormalize
      const exported = pluginExported;
      if (!exported) {
        throw new Error(`No rule plugins exported by ${moduleSpecifier}.`);
      }
      if (Array.isArray(exported)) {
        pluginRules = exported as CodepolPluginRule[];
      } else if (typeof exported === 'object' && exported !== undefined) {
        const candidate = exported as { pluginRules?: unknown };
        if (Array.isArray(candidate.pluginRules)) {
          pluginRules = candidate.pluginRules as CodepolPluginRule[];
        } else {
          throw new Error(`Invalid rule plugin export from ${moduleSpecifier}. Expected an array of rule plugins.`);
        }
      } else {
        throw new Error(`Invalid rule plugin export from ${moduleSpecifier}.`);
      }
    } catch (e: unknown) {
      return Err(e instanceof Error ? e.message : String(e));
    }

    for (const pluginRule of pluginRules) {
      if (!pluginRule.id) {
         return Err(`Rule plugin from ${moduleSpecifier} missing id.`);
      }
      if (pluginRule.id.includes('/')) {
        return Err(
          `Rule plugin id "${pluginRule.id}" from ${moduleSpecifier} must not contain '/'. ` +
          `The '/' character is reserved for namespacing (e.g., "@scope/plugin/rule-id").`
        );
      }
      
      const resolvedId = ruleIDGetWithNamespace(pluginRule.id, moduleSpecifier);

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

    // For tree checks, we need the treeCheckProvider
    const treeCheckProvider = plugin.pluginRule.capabilities.treeCheckProvider;
    if (!treeCheckProvider) {
       return Err(`Plugin ${resolvedId} does not support tree checks (missing treeCheckProvider) for rule ${rule.id || ruleId}.`);
    }

    const targets = policyRuleTargetsResolve(rule, policy);
    for (const target of targets) {
      if (!treeCheckProvider.languages.includes(target.language)) {
        return Err(`Plugin ${resolvedId} does not support language ${target.language} for rule ${rule.id || ruleId}.`);
      }
    }
  }

  return Ok(pluginsMapGet);
}

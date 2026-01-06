import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  PolicyFile,
  PolicyPlugin,
  PolicyPluginDeclaration,
} from './policyTypes';
import { policyPluginLogger } from './policyPluginLogger';
import { Result, Ok, Err, isErr } from '../result/result';

export const defaultPluginType = 'logger';

export type PolicyPluginsMap = Map<string, PolicyPlugin>;

const pluginsBuiltinMap: Record<string, PolicyPlugin> = {
  logger: policyPluginLogger,
};

async function policyPluginGet(
  declaration: PolicyPluginDeclaration,
  cwd: string,
  source: 'module' | 'builtin'
): Promise<Result<PolicyPlugin, string>> {
  let plugin: PolicyPlugin;

  if (source === 'builtin') {
    if (!declaration.builtin) {
      const error = 'Plugin declaration missing builtin identifier.';
      console.error(error);
      return Err(error);
    }
    const pluginBuiltin = pluginsBuiltinMap[declaration.builtin];
    if (!pluginBuiltin) {
      const error = `Unknown builtin plugin: ${declaration.builtin}.`;
      console.error(error);
      return Err(error);
    }
    plugin = pluginBuiltin;
  } else {
    if (!declaration.module) {
      const error = 'Plugin declaration missing module specifier.';
      console.error(error);
      return Err(error);
    }
    const moduleSpecifier = declaration.module;
    const moduleSource = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')
      ? pathToFileURL(path.resolve(cwd, moduleSpecifier)).href
      : moduleSpecifier;
    const moduleLoaded = await import(moduleSource);
    let pluginExported;
    if (declaration.export) {
      pluginExported = moduleLoaded[declaration.export];
    } else {
      pluginExported = moduleLoaded.plugin;
      if (moduleLoaded.default != null) {
        pluginExported = moduleLoaded.default;
      }
    }
    if (!pluginExported) {
      const error = `No plugin export found in ${moduleSpecifier}.`;
      console.error(error);
      return Err(error);
    }
    plugin = pluginExported as PolicyPlugin;
  }

  const sourceLabel = source === 'builtin' ? `builtin:${declaration.builtin}` : declaration.module!;
  if (!plugin.id || !plugin.version || !plugin.scan) {
    const error = `Invalid plugin exported by ${sourceLabel}.`;
    console.error(error);
    return Err(error);
  }
  if (!Array.isArray(plugin.languages)) {
    const error = `Plugin ${plugin.id} must declare supported languages.`;
    console.error(error);
    return Err(error);
  }

  return Ok(plugin);
}

/**
 * Loads plugins declared in the policy into a map keyed by plugin id.
 * @returns Result containing the plugins map or an error message
 */
export async function policyPluginsGet(
  policy: PolicyFile,
  cwd: string
): Promise<Result<PolicyPluginsMap, string>> {
  let declarations: PolicyPluginDeclaration[] = [];
  if (policy.plugins != null) {
    declarations = policy.plugins;
  }
  const pluginsMapGet = new Map<string, PolicyPlugin>();

  for (const declaration of declarations) {
    const source = declaration.builtin ? 'builtin' : 'module';
    const pluginResult = await policyPluginGet(declaration, cwd, source);
    if (isErr(pluginResult)) {
      return pluginResult;
    }
    const plugin = pluginResult.Ok;
    if (pluginsMapGet.has(plugin.id)) {
      const error = `Duplicate plugin id detected: ${plugin.id}.`;
      console.error(error);
      return Err(error);
    }
    pluginsMapGet.set(plugin.id, plugin);
  }

  // Auto-register built-in plugins for rule types that reference them
  for (const rule of policy.rules) {
    let ruleType = defaultPluginType;
    if (rule.type != null) {
      ruleType = rule.type;
    }
    if (!pluginsMapGet.has(ruleType) && pluginsBuiltinMap[ruleType]) {
      const builtinPlugin = pluginsBuiltinMap[ruleType];
      pluginsMapGet.set(ruleType, builtinPlugin);
    }
  }

  for (const plugin of pluginsMapGet.values()) {
    if (plugin.init) {
      await plugin.init({ cwd: cwd, policy: policy });
    }
  }

  for (const rule of policy.rules) {
    let ruleType = defaultPluginType;
    if (rule.type != null) {
      ruleType = rule.type;
    }
    const plugin = pluginsMapGet.get(ruleType);
    if (!plugin) {
      const error = `No plugin registered for rule type ${ruleType}.`;
      console.error(error);
      return Err(error);
    }
    if (!plugin.languages.includes(rule.language)) {
      const error = `Plugin ${plugin.id} does not support language ${rule.language} for rule ${rule.id}.`;
      console.error(error);
      return Err(error);
    }
  }

  return Ok(pluginsMapGet);
}

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  PolicyFile,
  PolicyPlugin,
  PolicyPluginDeclaration,
} from './policyTypes';
import { Result, Ok, Err, isErr } from '../result/result';

export const defaultPluginType = 'logger';

export type PolicyPluginsMap = Map<string, PolicyPlugin>;

const pluginsBuiltinModules: Record<string, string> = {
  logger: '@codepol/plugin',
};

async function policyPluginGet(
  declaration: PolicyPluginDeclaration,
  cwd: string
): Promise<Result<PolicyPlugin, string>> {
  let moduleSpecifier = declaration.module;
  if (declaration.builtin) {
    moduleSpecifier = pluginsBuiltinModules[declaration.builtin];
    if (!moduleSpecifier) {
      const error = `Unknown builtin plugin: ${declaration.builtin}.`;
      console.error(error);
      return Err(error);
    }
  }
  if (!moduleSpecifier) {
    const error = 'Plugin declaration missing module specifier.';
    console.error(error);
    return Err(error);
  }
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
  const plugin = pluginExported as PolicyPlugin;

  const sourceLabel = declaration.builtin ? `builtin:${declaration.builtin}` : moduleSpecifier;
  if (!plugin.id || !plugin.version || !plugin.check) {
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
    const pluginResult = await policyPluginGet(declaration, cwd);
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

  for (const plugin of pluginsMapGet.values()) {
    if (plugin.init) {
      await plugin.init({ cwd: cwd, policy: policy });
    }
  }

  for (const rule of policy.rules) {
    let ruleType = defaultPluginType;
    if (rule.semantics.type != null) {
      ruleType = rule.semantics.type;
    }
    const plugin = pluginsMapGet.get(ruleType);
    if (!plugin) {
      const error = `No plugin registered for rule type ${ruleType}.`;
      console.error(error);
      return Err(error);
    }
    for (const target of rule.targets) {
      if (!plugin.languages.includes(target.language)) {
        const error = `Plugin ${plugin.id} does not support language ${target.language} for rule ${rule.id}.`;
        console.error(error);
        return Err(error);
      }
    }
  }

  return Ok(pluginsMapGet);
}

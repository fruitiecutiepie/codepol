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

async function policyPluginGet(
  declaration: PolicyPluginDeclaration,
  cwd: string
): Promise<Result<PolicyPlugin, string>> {
  const moduleSpecifier = declaration.module;
  const moduleSource = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')
    ? pathToFileURL(path.resolve(cwd, moduleSpecifier)).href
    : moduleSpecifier;
  const moduleLoaded = await import(moduleSource);
  const pluginExported = moduleLoaded[declaration.export];
  if (!pluginExported) {
    const error = `Module ${moduleSpecifier} does not export "${declaration.export}".`;
    return Err(error);
  }
  const plugin = pluginExported as PolicyPlugin;

  if (!plugin.id || !plugin.version || !plugin.capabilities) {
    const error = `Invalid plugin exported by ${moduleSpecifier}.`;
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
      return Err(error);
    }

    // For tree checks, we need the treeCheckProvider
    const treeCheckProvider = plugin.capabilities.treeCheckProvider;
    if (!treeCheckProvider) {
       // If the rule is strictly for other providers (e.g. lint), we might not fail here?
       // But this function seems to prepare for policyTreeCheck.
       // Let's assume strictness for now.
       const error = `Plugin ${plugin.id} does not support tree checks (missing treeCheckProvider) for rule ${rule.id}.`;
       return Err(error);
    }

    for (const target of rule.targets) {
      if (!treeCheckProvider.languages.includes(target.language)) {
        const error = `Plugin ${plugin.id} does not support language ${target.language} for rule ${rule.id}.`;
        return Err(error);
      }
    }
  }

  return Ok(pluginsMapGet);
}

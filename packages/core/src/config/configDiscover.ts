import fs from 'node:fs';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import type { CodepolConfig, ConfigFileResult } from './configTypes';
import { configValidate } from './configValidate';
import { andThen, Err, isErr, Ok, type Result, resultMessageFromUnknown, resultFrom } from '../result/result';
import { WorkspaceFault } from '../workspace/workspaceFault';

/** Supported config filename. */
const CONFIG_FILENAME = 'codepol.toml' as const;

/**
 * Cache for loaded configs by absolute path.
 */
const configCache = new Map<string, CodepolConfig>();

/**
 * Clears the config cache.
 * Useful for testing or when config files are modified.
 */
export function configCacheClear(): void {
  configCache.clear();
}

/**
 * Walks up from the starting directory to find `codepol.toml`.
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path to the config file, or null if not found
 */
export function configFileDiscover(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const candidate = path.join(currentDir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  const rootCandidate = path.join(root, CONFIG_FILENAME);
  if (fs.existsSync(rootCandidate)) {
    return rootCandidate;
  }

  return null;
}

/**
 * Parses config source text and validates it against the runtime config schema.
 */
export function configParseFromSource(
  source: string,
  options: {
    configPath?: string;
  } = {}
): Result<CodepolConfig, WorkspaceFault> {
  const configPath = options.configPath ?? '<inline>';
  const parsedR = resultFrom<unknown, unknown>(() => TOML.parse(source) as unknown);
  if (isErr(parsedR)) {
    const message = resultMessageFromUnknown(parsedR.Err);
    return Err(new WorkspaceFault(`Failed to parse config file ${configPath}: ${message}`));
  }
  return configValidate(parsedR.Ok);
}

function configFileParse(configPath: string): Result<CodepolConfig, WorkspaceFault> {
  const raw = fs.readFileSync(configPath, 'utf8');
  return configParseFromSource(raw, { configPath });
}

async function configFileLoadAsync(
  configPath: string
): Promise<Result<CodepolConfig, WorkspaceFault>> {
  const cached = configCache.get(configPath);
  if (cached) {
    return Ok(cached);
  }

  const configR = configFileParse(configPath);
  if (isErr(configR)) {
    return configR;
  }
  configCache.set(configPath, configR.Ok);
  return Ok(configR.Ok);
}

function configFileLoadSync(configPath: string): Result<CodepolConfig, WorkspaceFault> {
  const cached = configCache.get(configPath);
  if (cached) {
    return Ok(cached);
  }

  const configR = configFileParse(configPath);
  if (isErr(configR)) {
    return configR;
  }
  configCache.set(configPath, configR.Ok);
  return Ok(configR.Ok);
}

/**
 * Discovers and loads the codepol config file.
 */
export async function configGet(
  cwd?: string
): Promise<Result<ConfigFileResult, WorkspaceFault>> {
  const startDir = cwd ?? process.cwd();
  const configPath = configFileDiscover(startDir);

  if (!configPath) {
    return Err(new WorkspaceFault(`No codepol config found. Create ${CONFIG_FILENAME}.`));
  }

  return andThen(await configFileLoadAsync(configPath), (config) =>
    Ok({ config, configPath })
  );
}

/**
 * Discovers and loads the codepol config file synchronously.
 */
export function configGetSync(cwd?: string): Result<ConfigFileResult, WorkspaceFault> {
  const startDir = cwd ?? process.cwd();
  const configPath = configFileDiscover(startDir);

  if (!configPath) {
    return Err(new WorkspaceFault(`No codepol config found. Create ${CONFIG_FILENAME}.`));
  }

  return andThen(configFileLoadSync(configPath), (config) => Ok({ config, configPath }));
}

/**
 * Loads a config file from a specific path.
 */
export async function configGetFromPath(
  configPath: string
): Promise<Result<ConfigFileResult, WorkspaceFault>> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    return Err(new WorkspaceFault(`Config file not found: ${absolutePath}`));
  }

  return andThen(await configFileLoadAsync(absolutePath), (config) =>
    Ok({ config, configPath: absolutePath })
  );
}

/**
 * Loads a config file from a specific path synchronously.
 */
export function configGetFromPathSync(
  configPath: string
): Result<ConfigFileResult, WorkspaceFault> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    return Err(new WorkspaceFault(`Config file not found: ${absolutePath}`));
  }

  return andThen(configFileLoadSync(absolutePath), (config) =>
    Ok({ config, configPath: absolutePath })
  );
}

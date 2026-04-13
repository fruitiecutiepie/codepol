import fs from 'node:fs';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import type { CodepolConfig, ConfigFileResult } from './configTypes';
import { configValidate } from './configValidate';

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
 *
 * @example
 * ```ts
 * const configPath = configFileDiscover(process.cwd());
 * if (configPath) {
 *   console.log(`Found config at: ${configPath}`);
 * }
 * ```
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
  } = {},
): CodepolConfig {
  try {
    const parsed = TOML.parse(source) as unknown;
    return configValidate(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const configPath = options.configPath ?? '<inline>';
    throw new Error(`Failed to parse config file ${configPath}: ${message}`);
  }
}

/**
 * Parses TOML from disk and validates it against the runtime config schema.
 */
function configFileParse(configPath: string): CodepolConfig {
  const raw = fs.readFileSync(configPath, 'utf8');
  return configParseFromSource(raw, { configPath });
}

/**
 * Loads and parses a config file (async version).
 *
 * @param configPath - Absolute path to the config file
 * @returns The parsed config object
 */
async function configFileLoadAsync(configPath: string): Promise<CodepolConfig> {
  const cached = configCache.get(configPath);
  if (cached) {
    return cached;
  }

  const config = configFileParse(configPath);
  configCache.set(configPath, config);
  return config;
}

/**
 * Loads and parses a config file synchronously.
 * Used by ESLint adapter which requires sync execution.
 *
 * @param configPath - Absolute path to the config file
 * @returns The parsed config object
 */
function configFileLoadSync(configPath: string): CodepolConfig {
  const cached = configCache.get(configPath);
  if (cached) {
    return cached;
  }

  const config = configFileParse(configPath);
  configCache.set(configPath, config);
  return config;
}

/**
 * Discovers and loads the codepol config file.
 * Walks up from the current directory to find the nearest config file.
 *
 * @param cwd - Working directory to start search from (default: process.cwd())
 * @returns The loaded config and its path
 * @throws If no config file is found
 *
 * @example
 * ```ts
 * import { configGet } from '@codepol/core';
 *
 * const { config, configPath } = await configGet();
 * console.log(`Loaded config from: ${configPath}`);
 * console.log(`Rules: ${config.rules.length}`);
 * ```
 */
export async function configGet(cwd?: string): Promise<ConfigFileResult> {
  const startDir = cwd ?? process.cwd();
  const configPath = configFileDiscover(startDir);

  if (!configPath) {
    throw new Error(`No codepol config found. Create ${CONFIG_FILENAME}.`);
  }

  const config = await configFileLoadAsync(configPath);
  return { config, configPath };
}

/**
 * Discovers and loads the codepol config file synchronously.
 * Used by ESLint adapter which requires sync execution.
 *
 * @param cwd - Working directory to start search from (default: process.cwd())
 * @returns The loaded config and its path
 * @throws If no config file is found
 *
 * @example
 * ```ts
 * import { configGetSync } from '@codepol/core';
 *
 * const { config, configPath } = configGetSync();
 * ```
 */
export function configGetSync(cwd?: string): ConfigFileResult {
  const startDir = cwd ?? process.cwd();
  const configPath = configFileDiscover(startDir);

  if (!configPath) {
    throw new Error(`No codepol config found. Create ${CONFIG_FILENAME}.`);
  }

  const config = configFileLoadSync(configPath);
  return { config, configPath };
}

/**
 * Loads a config file from a specific path.
 * Use this when you have an explicit path (e.g., from --config flag).
 *
 * @param configPath - Path to the config file (absolute or relative)
 * @returns The loaded config and its resolved path
 *
 * @example
 * ```ts
 * const { config } = await configGetFromPath('./codepol.toml');
 * ```
 */
export async function configGetFromPath(configPath: string): Promise<ConfigFileResult> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const config = await configFileLoadAsync(absolutePath);
  return { config, configPath: absolutePath };
}

/**
 * Loads a config file from a specific path synchronously.
 * Used by ESLint adapter which requires sync execution.
 *
 * @param configPath - Path to the config file (absolute or relative)
 * @returns The loaded config and its resolved path
 *
 * @example
 * ```ts
 * const { config } = configGetFromPathSync('./codepol.toml');
 * ```
 */
export function configGetFromPathSync(configPath: string): ConfigFileResult {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const config = configFileLoadSync(absolutePath);
  return { config, configPath: absolutePath };
}

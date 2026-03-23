import fs from 'node:fs';
import path from 'node:path';
import type { CodepolConfig, ConfigFileResult } from './configTypes';

/**
 * Returns jiti alias config that maps '@codepol/core' to a stub file
 * so config files can `import { defineConfig } from '@codepol/core'`
 * without needing node_modules.
 */
function coreModuleAlias(): Record<string, string> {
  const stubName = 'codepol-core-stub.cjs';
  const candidates = [
    path.resolve(__dirname, stubName),
    path.resolve(__dirname, '..', stubName),
    path.resolve(path.dirname(process.execPath), stubName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { '@codepol/core': candidate };
    }
  }
  return {};
}

/**
 * Supported config file names in order of precedence.
 * First match wins when walking up the directory tree.
 */
const CONFIG_FILENAMES = [
  'codepol.config.ts',
  'codepol.config.mts',
  'codepol.config.js',
  'codepol.config.mjs',
  'codepol.config.cjs',
] as const;

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
 * Walks up from the starting directory to find a config file.
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path to the config file, or null if not found
 *
 * @example
 * ```typescript
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
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(currentDir, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  // Check root directory as well
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.join(root, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Loads a JS/TS config file using jiti for TypeScript support (async).
 */
async function loadJsConfigAsync(configPath: string): Promise<CodepolConfig> {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(configPath, {
    interopDefault: true,
    alias: coreModuleAlias(),
  });

  const loaded = await jiti.import(configPath);

  // Handle default export
  const config = (loaded as { default?: CodepolConfig }).default ?? loaded;
  return config as CodepolConfig;
}

/**
 * Loads a JS/TS config file using jiti synchronously.
 * Used by ESLint adapter which requires sync execution.
 */
function loadJsConfigSync(configPath: string): CodepolConfig {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createJiti } = require('jiti') as typeof import('jiti');
  const jiti = createJiti(configPath, {
    interopDefault: true,
    alias: coreModuleAlias(),
  });

  // Use jiti as a function for synchronous require
  const loaded = jiti(configPath);

  // Handle default export
  const config = (loaded as { default?: CodepolConfig }).default ?? loaded;
  return config as CodepolConfig;
}

/**
 * Loads and parses a config file (async version).
 * Handles JS/TS formats.
 *
 * @param configPath - Absolute path to the config file
 * @returns The parsed config object
 */
async function configFileLoadAsync(configPath: string): Promise<CodepolConfig> {
  const cached = configCache.get(configPath);
  if (cached) {
    return cached;
  }

  const config = await loadJsConfigAsync(configPath);
  configCache.set(configPath, config);
  return config;
}

/**
 * Loads and parses a config file synchronously.
 * Handles JS/TS formats.
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

  const config = loadJsConfigSync(configPath);
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
 * ```typescript
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
    throw new Error(
      `No codepol config found. Create one of:\n` +
        CONFIG_FILENAMES.map((f) => `  - ${f}`).join('\n')
    );
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
 * ```typescript
 * import { configGetSync } from '@codepol/core';
 *
 * const { config, configPath } = configGetSync();
 * ```
 */
export function configGetSync(cwd?: string): ConfigFileResult {
  const startDir = cwd ?? process.cwd();
  const configPath = configFileDiscover(startDir);

  if (!configPath) {
    throw new Error(
      `No codepol config found. Create one of:\n` +
        CONFIG_FILENAMES.map((f) => `  - ${f}`).join('\n')
    );
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
 * ```typescript
 * const { config } = await configGetFromPath('./my-config.ts');
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
 * ```typescript
 * const { config } = configGetFromPathSync('./my-config.ts');
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

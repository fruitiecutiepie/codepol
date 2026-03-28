/**
 * @packageDocumentation
 * Vulture-specific types for diagnostic output and adapter configuration.
 */

/**
 * A single finding from Vulture's text output, parsed into a structured form.
 *
 * Vulture output format: `filename:line: unused type 'name' (confidence% confidence)`
 */
export type VultureFinding = {
  /** Absolute or relative path to the file containing the finding */
  filePath: string;
  /** 1-based line number */
  line: number;
  /** Kind of unused code (e.g. 'function', 'class', 'import', 'variable', 'attribute', 'property') */
  type: string;
  /** Name of the unused symbol */
  name: string;
  /** Confidence percentage (60–100) */
  confidence: number;
};

/**
 * Configuration for running Vulture as a subprocess.
 */
export type VultureProviderConfig = {
  /** Path to the vulture binary (default: 'vulture') */
  vultureBin?: string;
  /** Path to pyproject.toml for Vulture config (passed as --config) */
  configPath?: string;
  /** Minimum confidence threshold (0–100). Findings below this are filtered out. */
  minConfidence?: number;
  /** Directory or file patterns to exclude */
  exclude?: string[];
  /** Symbol names to ignore */
  ignoreNames?: string[];
  /** Paths to whitelist .py files (appended as positional args) */
  whitelistPaths?: string[];
};

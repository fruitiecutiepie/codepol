/**
 * @packageDocumentation
 * Biome-specific types for reporter output and adapter configuration.
 */

import type { LintDiagnostic } from '@codepol/core';

/**
 * Configuration for running Biome as a subprocess.
 */
export type BiomeProviderConfig = {
  /** Path to the biome binary (default: 'biome') */
  biomeBin?: string;
  /** Path to biome.json or biome.jsonc */
  configPath?: string;
  /** Extra CLI arguments */
  extraArgs?: string[];
};

/**
 * 0-based line/column position emitted by Biome's RDJSON reporter.
 */
export type BiomeDiagnosticPosition = {
  line: number;
  column: number;
};

/**
 * Diagnostic range emitted by Biome's RDJSON reporter.
 */
export type BiomeDiagnosticRange = {
  start: BiomeDiagnosticPosition;
  end: BiomeDiagnosticPosition;
};

/**
 * Diagnostic location emitted by Biome's RDJSON reporter.
 */
export type BiomeDiagnosticLocation = {
  path: string;
  range: BiomeDiagnosticRange;
};

/**
 * Diagnostic code emitted by Biome's RDJSON reporter.
 */
export type BiomeDiagnosticCode = {
  value: string;
  url?: string;
};

/**
 * A single diagnostic emitted by `biome lint --reporter=rdjson`.
 */
export type BiomeDiagnostic = {
  code?: BiomeDiagnosticCode;
  location?: BiomeDiagnosticLocation;
  message: string;
  severity?: string;
};

/**
 * Top-level RDJSON document emitted by Biome.
 */
export type BiomeReport = {
  diagnostics?: BiomeDiagnostic[];
};

/**
 * An adapted rule produced by the biome adapter.
 * Wraps a TreeCheckProvider to run its check directly on JS/TS files
 * and return LintDiagnostic[].
 */
export type BiomeAdaptedRule = {
  ruleId: string;
  ruleName: string;
  check: (filePath: string, source: string, ruleArgs?: unknown) => LintDiagnostic[];
};

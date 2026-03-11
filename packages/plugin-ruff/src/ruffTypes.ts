/**
 * @packageDocumentation
 * Ruff-specific types for diagnostic output and adapter configuration.
 */

/**
 * Location in a source file as reported by Ruff (1-based row and column).
 */
export type RuffLocation = {
  row: number;
  column: number;
};

/**
 * A single edit operation from a Ruff auto-fix.
 */
export type RuffEdit = {
  content: string;
  location: RuffLocation;
  end_location: RuffLocation;
};

/**
 * Fix information attached to a Ruff diagnostic.
 */
export type RuffFix = {
  applicability: 'safe' | 'unsafe';
  message: string;
  edits: RuffEdit[];
};

/**
 * A single diagnostic emitted by `ruff check --output-format=json`.
 */
export type RuffDiagnostic = {
  cell: number | null;
  code: string | null;
  message: string;
  filename: string;
  location: RuffLocation;
  end_location: RuffLocation;
  fix: RuffFix | null;
  noqa_row: number;
  url: string | null;
};

/**
 * Configuration for running ruff as a subprocess.
 */
export type RuffProviderConfig = {
  /** Path to the ruff binary (default: 'ruff') */
  ruffBin?: string;
  /** Ruff rule codes to enable (e.g., ['E', 'F', 'I']) */
  select?: string[];
  /** Ruff rule codes to ignore */
  ignore?: string[];
  /** Path to ruff.toml or pyproject.toml */
  configPath?: string;
  /** Fixable rule codes */
  fixable?: string[];
  /** Extra CLI arguments */
  extraArgs?: string[];
};

/**
 * An adapted rule produced by the ruff adapter.
 * Wraps a TreeCheckProvider to run its check directly on a Python file
 * and return LintDiagnostic[].
 */
export type RuffAdaptedRule = {
  ruleId: string;
  ruleName: string;
  check: (filePath: string, source: string, ruleArgs?: unknown) => import('@codepol/core').LintDiagnostic[];
};

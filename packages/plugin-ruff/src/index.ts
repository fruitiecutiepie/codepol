/**
 * @packageDocumentation
 * @codepol/plugin-ruff – Ruff lint adapter for codepol.
 *
 * Provides two capabilities:
 * 1. Adapt codepol TreeCheckProvider rules to run on Python files via tree-sitter.
 * 2. Run `ruff check` as a subprocess and collect violations.
 */

export { ruffAdapter } from './ruffAdapter';

export {
  ruffCheck,
  ruffCheckAsync,
  ruffFix,
  ruffFixAsync,
  ruffDiagnosticToViolation,
} from './ruffRunner';

export type {
  RuffDiagnostic,
  RuffEdit,
  RuffFix,
  RuffLocation,
  RuffProviderConfig,
  RuffAdaptedRule,
} from './ruffTypes';

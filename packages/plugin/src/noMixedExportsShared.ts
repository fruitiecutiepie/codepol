/**
 * Shared AST helpers for no-mixed-exports check and fix.
 */

import {
  export_statements_collect,
  mixedExportsAnalyze,
  primary_export_statement_get,
  statement_export_style_get,
  type ExportStyle,
  type MixedExportStatement,
} from './lib/moduleSyntax';

export type NoMixedExportsPreferredStyle = 'default' | 'named';

export type NoMixedExportsArgs = {
  preferredStyle?: NoMixedExportsPreferredStyle;
};

export type { ExportStyle, MixedExportStatement };
export {
  mixedExportsAnalyze,
  export_statements_collect,
  primary_export_statement_get,
  statement_export_style_get,
};

export function preferred_style_get(ruleArgs: unknown): ExportStyle | undefined {
  const preferredStyle = (ruleArgs as NoMixedExportsArgs | undefined)?.preferredStyle;
  if (preferredStyle === 'default' || preferredStyle === 'named') {
    return preferredStyle;
  }
  return undefined;
}

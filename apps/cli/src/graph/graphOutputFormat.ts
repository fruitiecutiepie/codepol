/**
 * Output format selection shared across all `codepol graph` subcommands.
 *
 * `json` emits the exact workspace-service query result shape so CI
 * consumers, panels, and tests can parse one payload. `text` emits a
 * deterministic human-readable rendering for terminal use.
 */
export type GraphOutputFormat = 'json' | 'text';

export function graphOutputFormatParse(raw: string | undefined): GraphOutputFormat {
  if (raw === 'text') return 'text';
  return 'json';
}

export function graphJsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

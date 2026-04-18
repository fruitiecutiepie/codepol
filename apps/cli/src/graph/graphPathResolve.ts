/**
 * Resolve a user-supplied file argument to the `file://` URI expected by
 * the workspace-service graph contract.
 *
 * Graph subcommands accept relative paths so they compose with shell
 * globs and CI tools; the workspace service speaks in URIs so panels and
 * CLI share a single payload shape.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function graphFileUriResolve(cwd: string, filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  return pathToFileURL(absolute).href;
}

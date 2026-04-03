import fs from 'node:fs';
import path from 'node:path';

/**
 * True when a Vulture-reported path refers to the same file as `targetFile` (absolute).
 * Uses realpath so `/var/...` vs `/private/var/...` on macOS match.
 */
export function vultureFindingMatchesFile(findingPath: string, targetFile: string): boolean {
  const absFinding = path.isAbsolute(findingPath)
    ? path.normalize(path.resolve(findingPath))
    : path.normalize(path.resolve(path.dirname(targetFile), findingPath));
  const resolvedTarget = path.normalize(path.resolve(targetFile));
  try {
    return (
      fs.realpathSync.native(absFinding) === fs.realpathSync.native(resolvedTarget)
    );
  } catch {
    return absFinding === resolvedTarget;
  }
}

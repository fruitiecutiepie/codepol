/**
 * Mirrors {@link WorkspaceFault} from `@codepol/core` for Node bootstrap scripts
 * that must not require a prior core build (e.g. `build:wasm`).
 */
export class WorkspaceFault {
  name = 'WorkspaceFault';

  /** @param {string} message */
  constructor(message) {
    this.message = message;
  }
}

/** Same behavior as `@codepol/core` — keeps script error reporting consistent without importing built packages. */
export function workspaceThrownMessageFromUnknown(error) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const candidate = /** @type {{ message: unknown }} */ (error).message;
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return String(error);
}

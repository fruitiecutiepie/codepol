/**
 * Structured invariant / RPC fault that is intentionally **not** an {@link Error}.
 */
export class WorkspaceFault {
  readonly name = 'WorkspaceFault' as const;
  constructor(public readonly message: string) {}
}

export function workspaceThrownMessageFromUnknown(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const candidate = (error as { message: unknown }).message;
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return String(error);
}

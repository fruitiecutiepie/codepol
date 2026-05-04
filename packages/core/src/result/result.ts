/**
 * Discriminated union for success (`Ok`) or failure (`Err`).
 *
 * **Exception capture:** Only {@link resultFrom} and {@link resultFromAsync} use
 * `try`/`catch` in this module. Prefer them when calling code that may throw.
 */

// TODO(result-refactor): Deferred backlog — implement incrementally:
// - Repo-wide guard (eslint rule or script) for `throw` / `try`/`catch` outside narrow allowlists (tests,
//   `resultFrom`/`resultFromAsync` wrappers, bootstrap entrypoints).
// - Docs/README/examples: prefer Result-based patterns where package APIs already return Result.
// - policyPluginProcess: migrate response validators (`recordExpect`, parses, …) from throw WorkspaceFault to Result.
// - FixProvider.apply and pluginBuiltinRegister: Result-capable surfaces instead of throw-only boundaries where viable.
// - packages/plugin jsTsTree + moduleSyntax helpers: explicit Result vs relying on treeCheckProviderNew's resultFrom.
// - TreeCheckFn / treeCheckProviderNew: optional checks that return Result directly to avoid double-wrap.
// - apps/cli, apps/lsp, apps/daemon + workspace RPC layers: unify recoverable failures with Result where contracts permit.
// - Workspace daemon client + index-build host: Promise.reject(abort/cancel) vs throw vs explicit Result — pick one convention.

export type Result<T, E> = { Ok: T; Err?: never } | { Err: E; Ok?: never };

export function Ok<T>(value: T): Result<T, never> {
  return { Ok: value };
}
export function Err<E>(error: E): Result<never, E> {
  return { Err: error };
}
export function isErr<T, E>(
  result: Result<T, E>
): result is { Err: E; Ok?: never } {
  return 'Err' in result;
}
export function isOk<T, E>(
  result: Result<T, E>
): result is { Ok: T; Err?: never } {
  return 'Ok' in result;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (isErr(result)) {
    return result;
  }
  return Ok(fn(result.Ok));
}

export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  if (isOk(result)) {
    return result;
  }
  return Err(fn(result.Err));
}

export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (isErr(result)) {
    return result;
  }
  return fn(result.Ok);
}

export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isOk(result)) {
    return result.Ok;
  }
  return defaultValue;
}

/** Short-circuit on first `Err`; otherwise collect all `Ok` values in order. */
export function resultAll<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const ok: T[] = [];
  for (const r of results) {
    if (isErr(r)) {
      return r;
    }
    ok.push(r.Ok);
  }
  return Ok(ok);
}

/** Best-effort string for logging or CLI from an unknown rejection / thrown value. */
export function resultMessageFromUnknown(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const candidate = (error as { message: unknown }).message;
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return String(error);
}

export function resultFrom<T, E>(fn: () => T): Result<T, E> {
  try {
    return { Ok: fn() };
  } catch (err: unknown) {
    return { Err: err as E };
  }
}
export const resFrom = resultFrom;

export async function resultFromAsync<T, E>(
  fn: () => Promise<T>
): Promise<Result<T, E>> {
  try {
    return { Ok: await fn() } as Result<T, E>;
  } catch (err: unknown) {
    return { Err: err as E };
  }
}
export const resFromAsync = resultFromAsync;

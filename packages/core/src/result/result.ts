/* eslint-disable codepol/no-unused-exports */
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
  return "Err" in result;
}
export function isOk<T, E>(
  result: Result<T, E>
): result is { Ok: T; Err?: never } {
  return "Ok" in result;
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

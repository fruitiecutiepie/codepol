export function* range(start: number, end: number): Generator<number> {
  for (let i = start; i < end; i++) {
    yield i;
  }
}

export function* fibonacci(): Generator<number> {
  let a = 0;
  let b = 1;
  while (true) {
    yield a;
    [a, b] = [b, a + b];
  }
}

export const double = (x: number): number => x * 2;

export const pipeline = (...fns: Array<(x: number) => number>) =>
  (value: number): number => fns.reduce((acc, fn) => fn(acc), value);

export function safeGet<T>(obj: Record<string, T> | null, key: string): T | undefined {
  return obj?.[key] ?? undefined;
}

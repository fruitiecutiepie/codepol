export function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function zip<A, B>(a: A[], b: B[]): Array<[A, B]> {
  const len = Math.min(a.length, b.length);
  const result: Array<[A, B]> = [];
  for (let i = 0; i < len; i++) {
    result.push([a[i], b[i]]);
  }
  return result;
}

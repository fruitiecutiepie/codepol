/**
 * Detects whether an identifier at `byteOffset` belongs to an `import type` statement.
 * The semantic index maps both value and type-only imports to SymbolKind `variable`;
 * when casing rules inspect an imported alias, `import type` should use the
 * type-name policy rather than the value-binding policy.
 */

/**
 * Walks upward from the line containing `byteOffset` until a line starting with `import`
 * is found, then returns whether that statement is `import type`.
 */
export function importBindingIsTypeOnly(
  source: string,
  byteOffset: number,
): boolean {
  const safe = Math.min(Math.max(0, byteOffset), source.length);
  let lineStart = source.lastIndexOf('\n', safe - 1) + 1;

  for (let depth = 0; depth < 40; depth++) {
    const lineEnd = source.indexOf('\n', lineStart);
    const line = source.slice(
      lineStart,
      lineEnd === -1 ? source.length : lineEnd,
    );

    if (/^\s*import\s+type\b/.test(line)) {
      return true;
    }
    if (/^\s*import\s+(?!type\b)/.test(line)) {
      return false;
    }

    if (lineStart === 0) {
      break;
    }
    lineStart = source.lastIndexOf('\n', lineStart - 2) + 1;
  }

  return false;
}

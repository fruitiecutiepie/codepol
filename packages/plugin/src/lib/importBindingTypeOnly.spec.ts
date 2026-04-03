import { describe, it, expect } from 'vitest';
import { importBindingIsTypeOnly } from './importBindingTypeOnly';

function offsetOf(source: string, needle: string): number {
  const i = source.indexOf(needle);
  if (i < 0) {
    throw new Error(`not found: ${needle}`);
  }
  return i;
}

describe('importBindingIsTypeOnly', () => {
  it('is true for names on same line as import type', () => {
    const src = `import type { FooBar } from 'x';\n`;
    expect(importBindingIsTypeOnly(src, offsetOf(src, 'FooBar'))).toBe(true);
  });

  it('is true for multiline import type', () => {
    const src = `import type {\n  TreeCheckLintAdapter,\n} from '@codepol/core';\n`;
    expect(importBindingIsTypeOnly(src, offsetOf(src, 'TreeCheckLintAdapter'))).toBe(
      true,
    );
  });

  it('is false for value import', () => {
    const src = `import { foo_bar } from './m';\n`;
    expect(importBindingIsTypeOnly(src, offsetOf(src, 'foo_bar'))).toBe(false);
  });

  it('is false for multiline value import', () => {
    const src = `import {\n  foo_bar,\n} from './m';\n`;
    expect(importBindingIsTypeOnly(src, offsetOf(src, 'foo_bar'))).toBe(false);
  });
});

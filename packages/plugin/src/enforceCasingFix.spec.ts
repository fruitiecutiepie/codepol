import { describe, it, expect } from 'vitest';
import { enforceCasingReplacements } from './enforceCasingFix';

describe('enforceCasingReplacements', () => {
  it('produces PascalCase for class-style input', () => {
    const r = enforceCasingReplacements('bad_class', ['PascalCase']);
    expect(r).toEqual([{ style: 'PascalCase', text: 'BadClass' }]);
  });

  it('preserves leading underscores', () => {
    const r = enforceCasingReplacements('_privateThing', ['camelCase']);
    expect(r[0]?.text).toBe('_privateThing');
  });

  it('dedupes when two styles collapse to the same text', () => {
    const r = enforceCasingReplacements('x', ['camelCase', 'snake_case']);
    expect(r).toHaveLength(1);
    expect(r[0]?.text).toBe('x');
  });

  it('returns multiple options when styles differ', () => {
    const r = enforceCasingReplacements('bad_NAME', ['camelCase', 'SCREAMING_SNAKE_CASE']);
    const texts = r.map((x) => x.text).sort();
    expect(texts).toEqual(['BAD_NAME', 'badName']);
  });
});

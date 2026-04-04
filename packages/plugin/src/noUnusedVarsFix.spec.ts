import { describe, expect, it } from 'vitest';
import type { SymbolRecord } from '@codepol/core';
import { noUnusedVarsViolationFixGet } from './noUnusedVarsFix';

function symbolStub(
  name: string,
  start: number,
  end: number,
): SymbolRecord {
  return {
    id: 'sym',
    kind: 'variable',
    name,
    file: '/tmp/unused.ts',
    byteRange: { start, end },
    scopeId: 's',
    qualName: name,
    flags: 0,
  };
}

describe('noUnusedVarsViolationFixGet', () => {
  it('removes a standalone unused const statement', () => {
    const source = `const unused = 1;\nconst keep = 2;\n`;
    const filePath = '/tmp/unused.ts';
    const sf = source.indexOf('unused');
    const fix = noUnusedVarsViolationFixGet(
      source,
      filePath,
      symbolStub('unused', sf, sf + 'unused'.length),
    );
    expect(fix).toBeDefined();
    const out =
      source.slice(0, fix!.byteRange.start) +
      fix!.text +
      source.slice(fix!.byteRange.end);
    expect(out).toBe(`const keep = 2;\n`);
  });

  it('prefixes an unused parameter with underscore', () => {
    const source = `function f(unused: number) { return 1; }\n`;
    const filePath = '/tmp/unused.ts';
    const pos = source.indexOf('unused');
    const fix = noUnusedVarsViolationFixGet(
      source,
      filePath,
      symbolStub('unused', pos, pos + 'unused'.length),
    );
    expect(fix?.text).toBe('_unused');
  });

  it('removes one named import specifier', () => {
    const source = `import { a, b } from 'm';\n`;
    const filePath = '/tmp/unused.ts';
    const pos = source.indexOf('a');
    const fix = noUnusedVarsViolationFixGet(
      source,
      filePath,
      symbolStub('a', pos, pos + 1),
    );
    expect(fix).toBeDefined();
    const out =
      source.slice(0, fix!.byteRange.start) +
      fix!.text +
      source.slice(fix!.byteRange.end);
    expect(out).toBe(`import { b } from 'm';\n`);
  });
});

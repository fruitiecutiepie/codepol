import { describe, expect, it } from 'vitest';
import {
  processPluginViolationParse,
} from './policyPluginProcess';

describe('processPluginViolationParse', () => {
  it('parses optional suggestions', () => {
    const v = processPluginViolationParse({
      ruleId: 'r',
      filePath: '/a.ts',
      message: 'm',
      line: 1,
      column: 1,
      suggestions: [
        {
          message: 'Rename to camelCase: x',
          fix: { byteRange: { start: 0, end: 1 }, text: 'x' },
        },
      ],
    });
    expect(v.suggestions).toHaveLength(1);
    expect(v.suggestions![0].message).toBe('Rename to camelCase: x');
    expect(v.suggestions![0].fix.byteRange).toEqual({ start: 0, end: 1 });
  });

  it('parses optional workspace edits on fixes', () => {
    const v = processPluginViolationParse({
      ruleId: 'r',
      filePath: '/a.ts',
      message: 'm',
      line: 1,
      column: 1,
      fix: {
        byteRange: { start: 0, end: 1 },
        text: 'x',
        edits: [
          {
            filePath: '/a.ts',
            byteRange: { start: 0, end: 1 },
            text: 'x',
          },
          {
            filePath: '/b.ts',
            byteRange: { start: 4, end: 7 },
            text: 'x',
          },
        ],
      },
    });

    expect(v.fix?.edits).toEqual([
      {
        filePath: '/a.ts',
        byteRange: { start: 0, end: 1 },
        text: 'x',
      },
      {
        filePath: '/b.ts',
        byteRange: { start: 4, end: 7 },
        text: 'x',
      },
    ]);
  });
});

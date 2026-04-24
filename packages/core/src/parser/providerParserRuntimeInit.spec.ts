import { beforeAll, describe, expect, it, vi } from 'vitest';
import { isErr, isOk } from '../result/result';
import { parserGetForFile } from './parserInit';
import { providerParserRuntimeInit } from './providerParserRuntimeInit';

describe('providerParserRuntimeInit', () => {
  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('initializes parser dependencies for eslint-adapted rules', async () => {
    expect(isErr(parserGetForFile('example.ts'))).toBe(true);
    expect(isErr(parserGetForFile('example.jsx'))).toBe(true);

    await providerParserRuntimeInit('eslint');

    expect(isOk(parserGetForFile('example.ts'))).toBe(true);
    expect(isOk(parserGetForFile('example.jsx'))).toBe(true);
  });
});

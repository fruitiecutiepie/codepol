import { describe, it, expect } from 'vitest';
import {
  containsForbiddenWord,
  forbiddenWordsCheck,
} from './forbiddenWordsCheck';
import type { PolicyRule, PolicyCheckContext } from '@codepol/core';
import { identifierSplitByCasing } from './lib/identifierSplitByCasing';

describe('identifierSplitByCasing', () => {
  it('handles simple lowercase', () => {
    expect(identifierSplitByCasing('data')).toEqual(['data']);
  });

  it('handles camelCase', () => {
    expect(identifierSplitByCasing('dataStore')).toEqual(['data', 'store']);
    expect(identifierSplitByCasing('myDataStore')).toEqual(['my', 'data', 'store']);
  });

  it('handles PascalCase', () => {
    expect(identifierSplitByCasing('DataStore')).toEqual(['data', 'store']);
  });

  it('handles snake_case', () => {
    expect(identifierSplitByCasing('user_data')).toEqual(['user', 'data']);
    expect(identifierSplitByCasing('user_data_store')).toEqual(['user', 'data', 'store']);
  });

  it('handles SCREAMING_SNAKE_CASE', () => {
    expect(identifierSplitByCasing('DATA_STORE')).toEqual(['data', 'store']);
  });

  it('handles kebab-case', () => {
    expect(identifierSplitByCasing('user-data')).toEqual(['user', 'data']);
  });

  it('handles acronyms followed by words', () => {
    expect(identifierSplitByCasing('XMLParser')).toEqual(['xml', 'parser']);
    expect(identifierSplitByCasing('IOData')).toEqual(['io', 'data']);
    expect(identifierSplitByCasing('HTMLDataURL')).toEqual(['html', 'data', 'url']);
  });

  it('handles words followed by acronyms', () => {
    expect(identifierSplitByCasing('parseXML')).toEqual(['parse', 'xml']);
    expect(identifierSplitByCasing('dataURL')).toEqual(['data', 'url']);
  });

  it('keeps compound words intact', () => {
    expect(identifierSplitByCasing('database')).toEqual(['database']);
    expect(identifierSplitByCasing('metadata')).toEqual(['metadata']);
    expect(identifierSplitByCasing('handlebar')).toEqual(['handlebar']);
  });

  it('handles numbers', () => {
    expect(identifierSplitByCasing('data2Store')).toEqual(['data2', 'store']);
    expect(identifierSplitByCasing('user123')).toEqual(['user123']);
  });

  it('handles leading/trailing underscores', () => {
    expect(identifierSplitByCasing('_data')).toEqual(['data']);
    expect(identifierSplitByCasing('data_')).toEqual(['data']);
    expect(identifierSplitByCasing('__data__')).toEqual(['data']);
  });
});

describe('containsForbiddenWord', () => {
  it('returns matched word for exact segment match', () => {
    expect(containsForbiddenWord('data', ['data'])).toBe('data');
    expect(containsForbiddenWord('dataStore', ['data'])).toBe('data');
    expect(containsForbiddenWord('myData', ['data'])).toBe('data');
  });

  it('returns null when word is part of compound word', () => {
    expect(containsForbiddenWord('database', ['data'])).toBeNull();
    expect(containsForbiddenWord('metadata', ['data'])).toBeNull();
    expect(containsForbiddenWord('handlebar', ['handle'])).toBeNull();
  });

  it('is case insensitive', () => {
    expect(containsForbiddenWord('DataStore', ['data'])).toBe('data');
    expect(containsForbiddenWord('dataStore', ['DATA'])).toBe('DATA');
  });

  it('checks multiple forbidden words', () => {
    expect(containsForbiddenWord('handleRequest', ['data', 'handle'])).toBe('handle');
    expect(containsForbiddenWord('processData', ['data', 'handle'])).toBe('data');
  });

  it('returns null when no match', () => {
    expect(containsForbiddenWord('userService', ['data', 'handle'])).toBeNull();
  });
});

describe('forbiddenWordsCheck', () => {
  const createContext = (source: string): PolicyCheckContext => ({
    filePath: 'test.ts',
    source,
    policy: { plugins: [], rules: [], exclude: [], targets: { 'ts': { language: 'typescript', files: ['**/*.ts'] } } },
    dir: '/test',
    target: { language: 'typescript', files: ['**/*.ts'] },
    ruleArgs: { words: ['data', 'handle', 'process'] },
  });

  const rule: PolicyRule = {
    id: 'test-rule',
    ruleId: 'forbidden-words',
    targets: ['ts'],
  };

  it('flags function with forbidden word', () => {
    const source = 'function handleRequest() {}';
    const violations = forbiddenWordsCheck(rule, createContext(source));
    
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('handleRequest');
    expect(violations[0].message).toContain('handle');
  });

  it('flags variable with forbidden word', () => {
    const source = 'const dataStore = {};';
    const violations = forbiddenWordsCheck(rule, createContext(source));
    
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('dataStore');
    expect(violations[0].message).toContain('data');
  });

  it('flags type with forbidden word', () => {
    const source = 'type ProcessResult = string;';
    const violations = forbiddenWordsCheck(rule, createContext(source));
    
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('ProcessResult');
    expect(violations[0].message).toContain('process');
  });

  it('allows compound words', () => {
    const source = `
      function queryDatabase() {}
      const metadata = {};
      type Handlebar = string;
    `;
    const violations = forbiddenWordsCheck(rule, createContext(source));
    
    expect(violations).toHaveLength(0);
  });

  it('reports correct line and column', () => {
    const source = `// comment
function handleRequest() {}`;
    const violations = forbiddenWordsCheck(rule, createContext(source));
    
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].column).toBe(10); // position of 'handleRequest'
  });

  it('returns empty array when no args provided', () => {
    const context = createContext('function handleRequest() {}');
    context.ruleArgs = undefined;
    
    const violations = forbiddenWordsCheck(rule, context);
    expect(violations).toHaveLength(0);
  });

  it('returns empty array when words array is empty', () => {
    const context = createContext('function handleRequest() {}');
    context.ruleArgs = { words: [] };
    
    const violations = forbiddenWordsCheck(rule, context);
    expect(violations).toHaveLength(0);
  });
});

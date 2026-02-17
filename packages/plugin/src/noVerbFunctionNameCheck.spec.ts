import { describe, it, expect } from 'vitest';
import {
  extractFunctions,
  buildVerbSet,
  startsWithVerb,
  noVerbFunctionNameCheck,
} from './noVerbFunctionNameCheck';
import type { PolicyRule, PolicyCheckContext } from '@codepol/core';

describe('startsWithVerb', () => {
  describe('segment-based matching', () => {
    it('flags function starting with verb segment', () => {
      const verbs = new Set(['handle']);
      expect(startsWithVerb('handleRequest', verbs)).toBe('handle');
    });

    it('allows compound word that starts with verb substring', () => {
      const verbs = new Set(['do']);
      expect(startsWithVerb('docPathFromName', verbs)).toBeNull();
    });

    it('flags exact verb as first segment', () => {
      const verbs = new Set(['do']);
      expect(startsWithVerb('doSomething', verbs)).toBe('do');
    });

    it('flags get prefix', () => {
      const verbs = new Set(['get']);
      expect(startsWithVerb('getData', verbs)).toBe('get');
    });

    it('allows getaway (compound word)', () => {
      const verbs = new Set(['get']);
      expect(startsWithVerb('getaway', verbs)).toBeNull();
    });

    it('flags process prefix', () => {
      const verbs = new Set(['process']);
      expect(startsWithVerb('processData', verbs)).toBe('process');
    });

    it('allows processor (compound word)', () => {
      const verbs = new Set(['process']);
      expect(startsWithVerb('processor', verbs)).toBeNull();
    });

    it('allows handlebar (compound word)', () => {
      const verbs = new Set(['handle']);
      expect(startsWithVerb('handlebar', verbs)).toBeNull();
    });
  });

  describe('acronym handling', () => {
    it('flags acronym as first segment', () => {
      const verbs = new Set(['xml']);
      expect(startsWithVerb('XMLParser', verbs)).toBe('xml');
    });

    it('flags verb before acronym', () => {
      const verbs = new Set(['parse']);
      expect(startsWithVerb('parseXML', verbs)).toBe('parse');
    });

    it('does not flag acronym when verb is different', () => {
      const verbs = new Set(['get']);
      expect(startsWithVerb('XMLParser', verbs)).toBeNull();
    });
  });

  describe('case insensitivity', () => {
    it('matches PascalCase function', () => {
      const verbs = new Set(['handle']);
      expect(startsWithVerb('HandleRequest', verbs)).toBe('handle');
    });

    it('matches SCREAMING_SNAKE_CASE function', () => {
      const verbs = new Set(['handle']);
      expect(startsWithVerb('HANDLE_REQUEST', verbs)).toBe('handle');
    });

    it('matches snake_case function', () => {
      const verbs = new Set(['handle']);
      expect(startsWithVerb('handle_request', verbs)).toBe('handle');
    });
  });

  describe('multiple verbs', () => {
    it('returns null when no verb matches', () => {
      const verbs = new Set(['get', 'set']);
      expect(startsWithVerb('userService', verbs)).toBeNull();
    });

    it('matches second verb in set', () => {
      const verbs = new Set(['get', 'set']);
      expect(startsWithVerb('setUser', verbs)).toBe('set');
    });

    it('matches first verb in set', () => {
      const verbs = new Set(['get', 'set']);
      expect(startsWithVerb('getUser', verbs)).toBe('get');
    });
  });

  describe('edge cases', () => {
    it('returns null for empty verbs set', () => {
      const verbs = new Set<string>();
      expect(startsWithVerb('handleRequest', verbs)).toBeNull();
    });

    it('returns null for empty function name', () => {
      const verbs = new Set(['handle']);
      expect(startsWithVerb('', verbs)).toBeNull();
    });

    it('handles single character function name', () => {
      const verbs = new Set(['x']);
      expect(startsWithVerb('x', verbs)).toBe('x');
    });

    it('handles underscore prefix', () => {
      const verbs = new Set(['handle']);
      expect(startsWithVerb('_handleRequest', verbs)).toBe('handle');
    });
  });
});

describe('buildVerbSet', () => {
  it('creates set from verbs array', () => {
    const set = buildVerbSet({ verbs: ['get', 'set', 'handle'] });
    expect(set.has('get')).toBe(true);
    expect(set.has('set')).toBe(true);
    expect(set.has('handle')).toBe(true);
  });

  it('lowercases all verbs', () => {
    const set = buildVerbSet({ verbs: ['GET', 'Set', 'HANDLE'] });
    expect(set.has('get')).toBe(true);
    expect(set.has('set')).toBe(true);
    expect(set.has('handle')).toBe(true);
    expect(set.has('GET')).toBe(false);
  });

  it('returns empty set for undefined args', () => {
    const set = buildVerbSet(undefined);
    expect(set.size).toBe(0);
  });

  it('returns empty set for empty verbs array', () => {
    const set = buildVerbSet({ verbs: [] });
    expect(set.size).toBe(0);
  });
});

describe('extractFunctions', () => {
  describe('function declarations', () => {
    it('extracts simple function declaration', () => {
      const source = 'function foo() {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('foo');
    });

    it('extracts exported function declaration', () => {
      const source = 'export function bar() {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('bar');
    });

    it('extracts async function declaration', () => {
      const source = 'async function baz() {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('baz');
    });

    it('extracts generator function declaration', () => {
      const source = 'function* gen() {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('gen');
    });
  });

  describe('arrow functions', () => {
    it('extracts const arrow function', () => {
      const source = 'const fn = () => {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('fn');
    });

    it('extracts async arrow function', () => {
      const source = 'const fn = async () => {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('fn');
    });

    it('extracts let arrow function', () => {
      const source = 'let fn = () => {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('fn');
    });

    it('extracts var arrow function', () => {
      const source = 'var fn = () => {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('fn');
    });
  });

  describe('function expressions', () => {
    it('extracts const function expression', () => {
      const source = 'const fn = function() {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('fn');
    });

    it('extracts named function expression (uses variable name)', () => {
      const source = 'const fn = function namedFn() {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('fn');
    });
  });

  describe('method declarations', () => {
    it('extracts class method', () => {
      const source = 'class C { method() {} }';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('method');
    });

    it('extracts multiple class methods', () => {
      const source = `class C {
        methodA() {}
        methodB() {}
      }`;
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(2);
      expect(fns.map(f => f.name)).toContain('methodA');
      expect(fns.map(f => f.name)).toContain('methodB');
    });

    it('extracts object literal method', () => {
      const source = 'const obj = { method() {} }';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('method');
    });

    it('extracts async method', () => {
      const source = 'class C { async fetchData() {} }';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('fetchData');
    });
  });

  describe('nested functions', () => {
    it('extracts nested function inside function', () => {
      const source = `
        function outer() {
          function inner() {}
        }
      `;
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(2);
      expect(fns.map(f => f.name)).toContain('outer');
      expect(fns.map(f => f.name)).toContain('inner');
    });

    it('extracts arrow function inside function', () => {
      const source = `
        function outer() {
          const inner = () => {};
        }
      `;
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(2);
      expect(fns.map(f => f.name)).toContain('outer');
      expect(fns.map(f => f.name)).toContain('inner');
    });
  });

  describe('non-function declarations', () => {
    it('does not extract variable declaration', () => {
      const source = 'const x = 1';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(0);
    });

    it('does not extract type alias', () => {
      const source = 'type Foo = () => void';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(0);
    });

    it('does not extract interface', () => {
      const source = 'interface Foo { bar(): void }';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(0);
    });

    it('does not extract class declaration (only methods)', () => {
      const source = 'class Foo {}';
      const fns = extractFunctions(source);
      expect(fns).toHaveLength(0);
    });
  });

  describe('line and column positions', () => {
    it('reports correct position for function on first line', () => {
      const source = 'function foo() {}';
      const fns = extractFunctions(source);
      expect(fns[0].line).toBe(1);
      expect(fns[0].column).toBe(10); // position of 'foo'
    });

    it('reports correct position for function on second line', () => {
      const source = '// comment\nfunction bar() {}';
      const fns = extractFunctions(source);
      expect(fns[0].line).toBe(2);
      expect(fns[0].column).toBe(10); // position of 'bar'
    });

    it('reports correct position for arrow function', () => {
      const source = 'const fn = () => {}';
      const fns = extractFunctions(source);
      expect(fns[0].line).toBe(1);
      expect(fns[0].column).toBe(7); // position of 'fn'
    });
  });
});

describe('noVerbFunctionNameCheck', () => {
  const createContext = (source: string, verbs: string[] = ['handle', 'get', 'process', 'do']): PolicyCheckContext => ({
    filePath: 'test.ts',
    source,
    policy: { plugins: [], rules: [], exclude: [], targets: { 'ts': { language: 'typescript', files: ['**/*.ts'] } } },
    dir: '/test',
    target: { language: 'typescript', files: ['**/*.ts'] },
    ruleArgs: { verbs },
  });

  const rule: PolicyRule = {
    id: 'test-rule',
    ruleId: 'no-verb-function-name',
    targets: ['ts'],
  };

  describe('should flag', () => {
    it('function declaration starting with verb', () => {
      const source = 'function handleRequest() {}';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('handleRequest');
      expect(violations[0].message).toContain('handle');
    });

    it('arrow function starting with verb', () => {
      const source = 'const getData = () => {}';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('getData');
      expect(violations[0].message).toContain('get');
    });

    it('class method starting with verb', () => {
      const source = 'class C { processItem() {} }';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('processItem');
      expect(violations[0].message).toContain('process');
    });

    it('multiple functions with verbs', () => {
      const source = `
        function handleRequest() {}
        const getData = () => {};
        class C { processItem() {} }
      `;
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(3);
    });
  });

  describe('should allow', () => {
    it('function with compound word starting with verb substring', () => {
      const source = 'function docPathFromName() {}';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(0);
    });

    it('function with compound word (getaway)', () => {
      const source = 'function getaway() {}';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(0);
    });

    it('function with compound word (handlebar)', () => {
      const source = 'function handlebar() {}';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(0);
    });

    it('function with compound word (processor)', () => {
      const source = 'function processor() {}';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(0);
    });

    it('function not starting with verb', () => {
      const source = 'function userService() {}';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(0);
    });

    it('function with verb in middle (not prefix)', () => {
      const source = 'function dataHandler() {}';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no args provided', () => {
      const context = createContext('function handleRequest() {}');
      context.ruleArgs = undefined;
      const violations = noVerbFunctionNameCheck(rule, context);
      expect(violations).toHaveLength(0);
    });

    it('returns empty array when verbs array is empty', () => {
      const context = createContext('function handleRequest() {}', []);
      const violations = noVerbFunctionNameCheck(rule, context);
      expect(violations).toHaveLength(0);
    });

    it('reports correct line and column', () => {
      const source = `// comment line
function handleRequest() {}`;
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(2);
      expect(violations[0].column).toBe(10); // position of 'handleRequest'
    });

    it('handles empty source', () => {
      const violations = noVerbFunctionNameCheck(rule, createContext(''));
      expect(violations).toHaveLength(0);
    });

    it('handles source with only comments', () => {
      const source = '// just a comment\n/* block comment */';
      const violations = noVerbFunctionNameCheck(rule, createContext(source));
      expect(violations).toHaveLength(0);
    });
  });
});

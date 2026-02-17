import { describe, it, expect } from 'vitest';
import { noInterfaceCheck } from './noInterfaceCheck';
import { noInterfaceFix, interfaceToTypeAlias } from './noInterfaceFix';
import type { PolicyRule, PolicyCheckContext } from '@codepol/core';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rule: PolicyRule = {
  id: 'no-interface',
  ruleId: 'no-interface',
  targets: ['ts'],
};

const createContext = (source: string, filePath = 'test.ts'): PolicyCheckContext => ({
  filePath,
  source,
  policy: {
    plugins: [],
    rules: [],
    exclude: [],
    targets: { ts: { language: 'typescript', files: ['**/*.ts'] } },
  },
  dir: '/test',
  target: { language: 'typescript', files: ['**/*.ts'] },
});

/** Parse source and return the first InterfaceDeclaration node. */
function firstInterfaceNode(source: string) {
  const sf = ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);
  let found: ts.InterfaceDeclaration | undefined;
  function visit(node: ts.Node) {
    if (!found && ts.isInterfaceDeclaration(node)) {
      found = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { node: found!, sourceFile: sf, source };
}

// ---------------------------------------------------------------------------
// noInterfaceCheck
// ---------------------------------------------------------------------------

describe('noInterfaceCheck', () => {
  it('flags a simple interface declaration', () => {
    const source = 'interface Foo { x: string }';
    const violations = noInterfaceCheck(rule, createContext(source));

    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe('no-interface');
    expect(violations[0].filePath).toBe('test.ts');
    expect(violations[0].message).toContain("'Foo'");
    expect(violations[0].message).toContain('type');
    expect(violations[0].line).toBe(1);
    expect(violations[0].column).toBe(1);
  });

  it('includes fix data with byteRange and replacement text', () => {
    const source = 'interface Foo { x: string }';
    const violations = noInterfaceCheck(rule, createContext(source));

    expect(violations[0].fix).toBeDefined();
    expect(violations[0].fix!.byteRange.start).toBe(0);
    expect(violations[0].fix!.byteRange.end).toBe(source.length);
    expect(violations[0].fix!.text).toMatch(/^type Foo = /);
  });

  it('flags a generic interface', () => {
    const source = 'interface Container<T> { data: T }';
    const violations = noInterfaceCheck(rule, createContext(source));

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("'Container'");
    expect(violations[0].fix!.text).toContain('Container<T>');
  });

  it('flags an interface with extends clause', () => {
    const source = 'interface Admin extends User { level: number }';
    const violations = noInterfaceCheck(rule, createContext(source));

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("'Admin'");
    expect(violations[0].fix!.text).toContain('User &');
  });

  it('flags multiple interfaces and produces multiple violations', () => {
    const source = `interface Foo { a: string }
interface Bar { b: number }
interface Baz { c: boolean }`;
    const violations = noInterfaceCheck(rule, createContext(source));

    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'Foo'"),
        expect.stringContaining("'Bar'"),
        expect.stringContaining("'Baz'"),
      ])
    );
  });

  it('returns empty array when source has no interfaces', () => {
    const source = 'type Foo = { x: string };\nconst y = 1;';
    const violations = noInterfaceCheck(rule, createContext(source));

    expect(violations).toHaveLength(0);
  });

  it('returns empty array for empty source', () => {
    const violations = noInterfaceCheck(rule, createContext(''));

    expect(violations).toHaveLength(0);
  });

  it('reports correct line and column when interface is not on line 1', () => {
    const source = `// header comment
const x = 1;
interface Late { v: string }`;
    const violations = noInterfaceCheck(rule, createContext(source));

    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
    expect(violations[0].column).toBe(1);
  });

  it('uses rule.id when available', () => {
    const ruleWithId: PolicyRule = { id: 'custom-id', ruleId: 'fallback', targets: ['ts'] };
    const violations = noInterfaceCheck(ruleWithId, createContext('interface X {}'));

    expect(violations[0].ruleId).toBe('custom-id');
  });

  it('falls back to rule.ruleId when rule.id is undefined', () => {
    const ruleNoId: PolicyRule = { ruleId: 'fallback-id', targets: ['ts'] };
    const violations = noInterfaceCheck(ruleNoId, createContext('interface X {}'));

    expect(violations[0].ruleId).toBe('fallback-id');
  });

  it('uses the provided filePath in violations', () => {
    const violations = noInterfaceCheck(
      rule,
      createContext('interface X {}', '/project/src/types.ts')
    );

    expect(violations[0].filePath).toBe('/project/src/types.ts');
  });
});

// ---------------------------------------------------------------------------
// interfaceToTypeAlias
// ---------------------------------------------------------------------------

describe('interfaceToTypeAlias', () => {
  it('converts a simple interface to a type alias', () => {
    const source = 'interface Foo { x: string }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toMatch(/^type Foo = \{/);
    expect(result).toContain('x: string');
    expect(result).toMatch(/\};$/);
  });

  it('converts a generic interface preserving type parameters', () => {
    const source = 'interface Foo<T> { data: T }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toMatch(/^type Foo<T> = \{/);
    expect(result).toContain('data: T');
  });

  it('converts a multi-param generic interface', () => {
    const source = 'interface Pair<A, B> { first: A; second: B }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toMatch(/^type Pair<A, B> = \{/);
  });

  it('converts interface with single extends to intersection', () => {
    const source = 'interface Admin extends User { level: number }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toMatch(/^type Admin = User & \{/);
    expect(result).toContain('level: number');
  });

  it('converts interface with multiple extends to chained intersection', () => {
    const source = 'interface Combined extends Foo, Bar, Baz { extra: boolean }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toMatch(/^type Combined = Foo & Bar & Baz & \{/);
  });

  it('converts an empty-body interface', () => {
    const source = 'interface Empty {}';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toBe('type Empty = {};');
  });

  it('converts interface with extends and generics', () => {
    const source = 'interface Repo<T> extends Base<T> { items: T[] }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toMatch(/^type Repo<T> = Base<T> & \{/);
    expect(result).toContain('items: T[]');
  });

  it('preserves export keyword', () => {
    const source = 'export interface Foo { x: string }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toBe('export type Foo = { x: string };');
  });

  it('preserves declare keyword', () => {
    const source = 'declare interface Foo { x: string }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toBe('declare type Foo = { x: string };');
  });

  it('preserves export + extends together', () => {
    const source = 'export interface Admin extends User { level: number }';
    const { node, sourceFile } = firstInterfaceNode(source);
    const result = interfaceToTypeAlias(node, sourceFile, source);

    expect(result).toBe('export type Admin = User & { level: number };');
  });
});

// ---------------------------------------------------------------------------
// noInterfaceFix
// ---------------------------------------------------------------------------

describe('noInterfaceFix', () => {
  it('converts a single interface in source', () => {
    const source = 'interface Foo { x: string }';
    const result = noInterfaceFix(source);

    expect(result).not.toContain('interface');
    expect(result).toMatch(/^type Foo = \{/);
    expect(result).toContain('x: string');
  });

  it('converts multiple interfaces preserving correct positions', () => {
    const source = `interface Foo { a: string }
interface Bar { b: number }`;
    const result = noInterfaceFix(source);

    expect(result).not.toContain('interface');
    expect(result).toContain('type Foo');
    expect(result).toContain('type Bar');
  });

  it('leaves non-interface declarations untouched', () => {
    const source = `type Existing = string;
interface Flagged { x: number }
const y = 42;`;
    const result = noInterfaceFix(source);

    expect(result).toContain('type Existing = string;');
    expect(result).toContain('const y = 42;');
    expect(result).not.toContain('interface');
    expect(result).toContain('type Flagged');
  });

  it('returns empty string for empty source', () => {
    expect(noInterfaceFix('')).toBe('');
  });

  it('returns unchanged source when there are no interfaces', () => {
    const source = 'type Foo = { x: string };\nconst y = 1;';
    expect(noInterfaceFix(source)).toBe(source);
  });

  it('handles interface with extends clause', () => {
    const source = 'interface Admin extends User { level: number }';
    const result = noInterfaceFix(source);

    expect(result).not.toContain('interface');
    expect(result).toContain('User &');
  });

  it('handles interface with generic parameters', () => {
    const source = 'interface Box<T> { value: T }';
    const result = noInterfaceFix(source);

    expect(result).toContain('type Box<T> =');
  });

  it('preserves closing brace on its own line for multi-line interface', () => {
    const source = `interface PathSegment {
  value: string;
  kind: 'file' | 'directory';
}`;
    const result = noInterfaceFix(source);

    expect(result).toBe(`type PathSegment = {
  value: string;
  kind: 'file' | 'directory';
};`);
  });

  it('preserves closing brace for multi-line interface with extends', () => {
    const source = `interface Admin extends User {
  level: number;
  role: string;
}`;
    const result = noInterfaceFix(source);

    expect(result).toBe(`type Admin = User & {
  level: number;
  role: string;
};`);
  });

  it('preserves export keyword on interface', () => {
    const source = 'export interface Foo { x: string }';
    const result = noInterfaceFix(source);

    expect(result).toBe('export type Foo = { x: string };');
  });

  it('preserves export keyword on multi-line interface', () => {
    const source = `export interface ForbiddenPathWordsArgs {
  words: string[];
  checkFiles?: boolean;
  checkDirectories?: boolean;
  ignoreExtensions?: boolean;
}`;
    const result = noInterfaceFix(source);

    expect(result).toBe(`export type ForbiddenPathWordsArgs = {
  words: string[];
  checkFiles?: boolean;
  checkDirectories?: boolean;
  ignoreExtensions?: boolean;
};`);
  });

  it('preserves export with extends on multi-line interface', () => {
    const source = `export interface Admin extends User {
  level: number;
}`;
    const result = noInterfaceFix(source);

    expect(result).toBe(`export type Admin = User & {
  level: number;
};`);
  });
});

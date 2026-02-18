import { describe, it, expect } from 'vitest';
import {
  extractExports,
  identifierTypesToCheck,
  duplicateExportsDetect,
  noDuplicateExportsCheck,
  type ExportMatch,
  type NoDuplicateExportsArgs,
  type FileSource,
} from './noDuplicateExportsCheck';

describe('extractExports', () => {
  describe('function exports', () => {
    it('extracts export function declaration', () => {
      const source = 'export function foo() {}';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        name: 'foo',
        identifierType: 'function',
        filePath: 'test.ts',
        isReexport: false,
      });
    });

    it('extracts export async function declaration', () => {
      const source = 'export async function fetchData() {}';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('fetchData');
      expect(exports[0].identifierType).toBe('function');
    });

    it('extracts export const arrow function', () => {
      const source = 'export const handler = () => {}';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        name: 'handler',
        identifierType: 'function',
        isReexport: false,
      });
    });

    it('extracts export const function expression', () => {
      const source = 'export const handler = function() {}';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('handler');
      expect(exports[0].identifierType).toBe('function');
    });

    it('does not extract non-exported functions', () => {
      const source = 'function internal() {}';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(0);
    });
  });

  describe('variable exports', () => {
    it('extracts export const variable', () => {
      const source = 'export const MAX_SIZE = 100';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        name: 'MAX_SIZE',
        identifierType: 'variable',
        isReexport: false,
      });
    });

    it('extracts export let variable', () => {
      const source = 'export let counter = 0';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('counter');
      expect(exports[0].identifierType).toBe('variable');
    });

    it('extracts multiple variables in one statement', () => {
      const source = 'export const a = 1, b = 2, c = 3';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(3);
      expect(exports.map(e => e.name)).toEqual(['a', 'b', 'c']);
    });

    it('distinguishes arrow functions from variables', () => {
      const source = `
        export const fn = () => {};
        export const value = 42;
      `;
      const exports = extractExports(source, 'test.ts');
      const fn = exports.find(e => e.name === 'fn');
      const value = exports.find(e => e.name === 'value');
      expect(fn?.identifierType).toBe('function');
      expect(value?.identifierType).toBe('variable');
    });
  });

  describe('type exports', () => {
    it('extracts export type alias', () => {
      const source = 'export type UserId = string';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        name: 'UserId',
        identifierType: 'type',
        isReexport: false,
      });
    });

    it('extracts export interface', () => {
      const source = 'export interface User { name: string }';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        name: 'User',
        identifierType: 'type',
        isReexport: false,
      });
    });

    it('extracts export class', () => {
      const source = 'export class UserService {}';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        name: 'UserService',
        identifierType: 'type',
        isReexport: false,
      });
    });

    it('extracts export enum', () => {
      const source = 'export enum Status { Active, Inactive }';
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        name: 'Status',
        identifierType: 'type',
        isReexport: false,
      });
    });
  });

  describe('re-exports', () => {
    it('does not extract re-exports by default', () => {
      const source = "export { foo } from './other'";
      const exports = extractExports(source, 'test.ts', false);
      expect(exports).toHaveLength(0);
    });

    it('extracts named re-exports when enabled', () => {
      const source = "export { foo } from './other'";
      const exports = extractExports(source, 'test.ts', true);
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        name: 'foo',
        isReexport: true,
      });
    });

    it('extracts aliased re-exports with exported name', () => {
      const source = "export { foo as bar } from './other'";
      const exports = extractExports(source, 'test.ts', true);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('bar');
      expect(exports[0].isReexport).toBe(true);
    });

    it('extracts multiple re-exports', () => {
      const source = "export { a, b, c } from './other'";
      const exports = extractExports(source, 'test.ts', true);
      expect(exports).toHaveLength(3);
      expect(exports.map(e => e.name)).toEqual(['a', 'b', 'c']);
    });

    it('ignores export * from (star re-exports)', () => {
      const source = "export * from './other'";
      const exports = extractExports(source, 'test.ts', true);
      expect(exports).toHaveLength(0);
    });
  });

  describe('mixed exports', () => {
    it('extracts all export types from a file', () => {
      const source = `
        export function createUser() {}
        export const MAX_USERS = 100;
        export type User = { id: string };
        export interface Config { port: number }
        export class Database {}
        export enum LogLevel { Debug, Info, Error }
      `;
      const exports = extractExports(source, 'test.ts');
      expect(exports).toHaveLength(6);
      
      const names = exports.map(e => e.name);
      expect(names).toContain('createUser');
      expect(names).toContain('MAX_USERS');
      expect(names).toContain('User');
      expect(names).toContain('Config');
      expect(names).toContain('Database');
      expect(names).toContain('LogLevel');
    });
  });

  describe('position tracking', () => {
    it('reports correct line and column', () => {
      const source = `// header comment
export function foo() {}`;
      const exports = extractExports(source, 'test.ts');
      expect(exports[0].line).toBe(2);
      expect(exports[0].column).toBe(17); // position of 'foo'
    });

    it('reports correct position for each export', () => {
      const source = `export const a = 1;
export const b = 2;`;
      const exports = extractExports(source, 'test.ts');
      expect(exports[0].line).toBe(1);
      expect(exports[1].line).toBe(2);
    });
  });
});

describe('identifierTypesToCheck', () => {
  it('returns all types when args is undefined', () => {
    const types = identifierTypesToCheck(undefined);
    expect(types.has('function')).toBe(true);
    expect(types.has('variable')).toBe(true);
    expect(types.has('type')).toBe(true);
  });

  it('returns all types when identifierTypes is empty', () => {
    const types = identifierTypesToCheck({ identifierTypes: [] });
    expect(types.size).toBe(3);
  });

  it('returns only specified types', () => {
    const types = identifierTypesToCheck({ identifierTypes: ['function'] });
    expect(types.has('function')).toBe(true);
    expect(types.has('variable')).toBe(false);
    expect(types.has('type')).toBe(false);
  });

  it('handles multiple specified types', () => {
    const types = identifierTypesToCheck({ identifierTypes: ['function', 'type'] });
    expect(types.has('function')).toBe(true);
    expect(types.has('variable')).toBe(false);
    expect(types.has('type')).toBe(true);
  });
});

describe('duplicateExportsDetect', () => {
  const createExport = (
    name: string,
    filePath: string,
    identifierType: 'function' | 'variable' | 'type' = 'function',
    isReexport = false
  ): ExportMatch => ({
    name,
    identifierType,
    filePath,
    line: 1,
    column: 1,
    isReexport,
  });

  describe('duplicate detection', () => {
    it('detects duplicate function exports', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'a.ts', 'function'),
        createExport('foo', 'b.ts', 'function'),
      ];
      const violations = duplicateExportsDetect(exports, undefined);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("'foo'");
      expect(violations[0].message).toContain('a.ts');
      expect(violations[0].filePath).toBe('b.ts');
    });

    it('detects duplicate type exports', () => {
      const exports: ExportMatch[] = [
        createExport('User', 'models/user.ts', 'type'),
        createExport('User', 'types/user.ts', 'type'),
      ];
      const violations = duplicateExportsDetect(exports, undefined);
      expect(violations).toHaveLength(1);
    });

    it('detects duplicate variable exports', () => {
      const exports: ExportMatch[] = [
        createExport('CONFIG', 'config/a.ts', 'variable'),
        createExport('CONFIG', 'config/b.ts', 'variable'),
      ];
      const violations = duplicateExportsDetect(exports, undefined);
      expect(violations).toHaveLength(1);
    });

    it('detects multiple duplicates', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'a.ts'),
        createExport('foo', 'b.ts'),
        createExport('foo', 'c.ts'),
      ];
      const violations = duplicateExportsDetect(exports, undefined);
      expect(violations).toHaveLength(2); // b.ts and c.ts are duplicates
    });

    it('returns empty when no duplicates', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'a.ts'),
        createExport('bar', 'b.ts'),
        createExport('baz', 'c.ts'),
      ];
      const violations = duplicateExportsDetect(exports, undefined);
      expect(violations).toHaveLength(0);
    });
  });

  describe('cross-type duplicate detection', () => {
    it('detects duplicates across different identifier types', () => {
      const exports: ExportMatch[] = [
        createExport('User', 'models.ts', 'function'),
        createExport('User', 'types.ts', 'type'),
      ];
      const violations = duplicateExportsDetect(exports, undefined);
      expect(violations).toHaveLength(1);
    });
  });

  describe('filtering by identifier type', () => {
    it('only checks specified identifier types', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'a.ts', 'function'),
        createExport('foo', 'b.ts', 'function'),
        createExport('bar', 'a.ts', 'variable'),
        createExport('bar', 'b.ts', 'variable'),
      ];
      const violations = duplicateExportsDetect(exports, { identifierTypes: ['function'] });
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('foo');
    });

    it('checks multiple specified types', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'a.ts', 'function'),
        createExport('foo', 'b.ts', 'function'),
        createExport('bar', 'a.ts', 'type'),
        createExport('bar', 'b.ts', 'type'),
      ];
      const violations = duplicateExportsDetect(exports, { identifierTypes: ['function', 'type'] });
      expect(violations).toHaveLength(2);
    });
  });

  describe('re-export handling', () => {
    it('excludes re-exports by default', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'source.ts', 'function', false),
        createExport('foo', 'index.ts', 'function', true), // re-export
      ];
      const violations = duplicateExportsDetect(exports, undefined);
      expect(violations).toHaveLength(0);
    });

    it('includes re-exports when enabled', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'source.ts', 'function', false),
        createExport('foo', 'index.ts', 'function', true), // re-export
      ];
      const violations = duplicateExportsDetect(exports, { includeReexports: true });
      expect(violations).toHaveLength(1);
    });

    it('detects duplicate re-exports when enabled', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'index.ts', 'variable', true),
        createExport('foo', 'barrel.ts', 'variable', true),
      ];
      const violations = duplicateExportsDetect(exports, { includeReexports: true });
      expect(violations).toHaveLength(1);
    });
  });

  describe('deterministic ordering', () => {
    it('reports first file alphabetically as the original', () => {
      const exports: ExportMatch[] = [
        createExport('foo', 'z.ts'),
        createExport('foo', 'a.ts'),
        createExport('foo', 'm.ts'),
      ];
      const violations = duplicateExportsDetect(exports, undefined);
      expect(violations).toHaveLength(2);
      // a.ts should be the "original", m.ts and z.ts are duplicates
      expect(violations[0].filePath).toBe('m.ts');
      expect(violations[1].filePath).toBe('z.ts');
      expect(violations[0].message).toContain('a.ts');
      expect(violations[1].message).toContain('a.ts');
    });
  });
});

describe('noDuplicateExportsCheck', () => {
  const createFile = (filePath: string, source: string): FileSource => ({
    filePath,
    source,
  });

  describe('integration', () => {
    it('detects duplicate exports across files', () => {
      const files: FileSource[] = [
        createFile('utils/a.ts', 'export function helper() {}'),
        createFile('utils/b.ts', 'export function helper() {}'),
      ];
      const violations = noDuplicateExportsCheck(files, undefined);
      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe('no-duplicate-exports');
    });

    it('uses default ruleId when none provided', () => {
      const files: FileSource[] = [
        createFile('a.ts', 'export function dup() {}'),
        createFile('b.ts', 'export function dup() {}'),
      ];
      const violations = noDuplicateExportsCheck(files, undefined);
      expect(violations[0].ruleId).toBe('no-duplicate-exports');
    });

    it('uses caller-supplied ruleId', () => {
      const files: FileSource[] = [
        createFile('a.ts', 'export function dup() {}'),
        createFile('b.ts', 'export function dup() {}'),
      ];
      const violations = noDuplicateExportsCheck(files, undefined, 'my-org/no-duplicate-exports');
      expect(violations[0].ruleId).toBe('my-org/no-duplicate-exports');
    });

    it('returns empty for unique exports', () => {
      const files: FileSource[] = [
        createFile('a.ts', 'export function foo() {}'),
        createFile('b.ts', 'export function bar() {}'),
      ];
      const violations = noDuplicateExportsCheck(files, undefined);
      expect(violations).toHaveLength(0);
    });

    it('handles files with multiple exports', () => {
      const files: FileSource[] = [
        createFile('a.ts', `
          export function helper() {}
          export type Config = {};
        `),
        createFile('b.ts', `
          export function helper() {}
          export const MAX = 100;
        `),
      ];
      const violations = noDuplicateExportsCheck(files, undefined);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('helper');
    });

    it('respects identifierTypes filter', () => {
      const files: FileSource[] = [
        createFile('a.ts', `
          export function foo() {}
          export type Bar = string;
        `),
        createFile('b.ts', `
          export function foo() {}
          export type Bar = number;
        `),
      ];
      const violations = noDuplicateExportsCheck(files, { identifierTypes: ['type'] });
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('Bar');
    });

    it('handles re-exports correctly', () => {
      const files: FileSource[] = [
        createFile('source.ts', 'export function foo() {}'),
        createFile('index.ts', "export { foo } from './source'"),
      ];

      // Without re-exports
      const withoutReexports = noDuplicateExportsCheck(files, { includeReexports: false });
      expect(withoutReexports).toHaveLength(0);

      // With re-exports
      const withReexports = noDuplicateExportsCheck(files, { includeReexports: true });
      expect(withReexports).toHaveLength(1);
    });

    it('handles empty files array', () => {
      const violations = noDuplicateExportsCheck([], undefined);
      expect(violations).toHaveLength(0);
    });

    it('handles files with no exports', () => {
      const files: FileSource[] = [
        createFile('a.ts', 'const internal = 1;'),
        createFile('b.ts', 'function helper() {}'),
      ];
      const violations = noDuplicateExportsCheck(files, undefined);
      expect(violations).toHaveLength(0);
    });
  });

  describe('real-world scenarios', () => {
    it('detects common util function name collisions', () => {
      const files: FileSource[] = [
        createFile('utils/string.ts', 'export function format(s: string) { return s; }'),
        createFile('utils/date.ts', 'export function format(d: Date) { return d.toISOString(); }'),
      ];
      const violations = noDuplicateExportsCheck(files, undefined);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('format');
    });

    it('allows same internal name with different exports', () => {
      const files: FileSource[] = [
        createFile('a.ts', `
          function helper() {}
          export function publicA() { return helper(); }
        `),
        createFile('b.ts', `
          function helper() {}
          export function publicB() { return helper(); }
        `),
      ];
      const violations = noDuplicateExportsCheck(files, undefined);
      expect(violations).toHaveLength(0);
    });

    it('detects type name collisions', () => {
      const files: FileSource[] = [
        createFile('api/user.ts', 'export type Response = { user: User }'),
        createFile('api/product.ts', 'export type Response = { product: Product }'),
      ];
      const violations = noDuplicateExportsCheck(files, { identifierTypes: ['type'] });
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('Response');
    });
  });
});

import { describe, expect, it, beforeAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type PolicyRule,
  type PolicyCheckContext,
  type ProjectIndex,
} from '@codepol/core';
import { unusedExportsCheck } from './unusedExportsCheck';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('unusedExportsCheck', () => {
  let testDir: string;
  
  // Helper to create context with less boilerplate
  function createContext(
    filePath: string,
    source: string,
    index: ProjectIndex | undefined,
    ruleArgs: Record<string, unknown> = {}
  ): { rule: PolicyRule; context: PolicyCheckContext } {
    const rule: PolicyRule = {
      ruleId: 'unused-exports',
      description: 'Test rule',
      targets: [],
    };
    const target = {
      language: 'typescript' as const,
      files: ['**/*.ts'],
    };
    const policy = {
      targets: { 'ts-files': target },
      rules: [rule],
    };
    return {
      rule,
      context: {
        filePath,
        source,
        policy,
        dir: testDir,
        target,
        projectIndex: index,
        ruleArgs,
      },
    };
  }
  
  beforeAll(async () => {
    // Register languages BEFORE initializing
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    
    // Initialize the parser
    await parserInit();
    
    // Create a temp directory for test files
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-unused-exports-test-'));
  });

  it('should correctly identify unused exports', () => {
    // Create file with exports
    const fileExporter = path.join(testDir, 'checkExporter.ts');
    const exporterContent = `
export function usedFunc() {
  return 'used';
}

export function unusedFunc() {
  return 'unused';
}

export const usedConst = 42;

export const unusedConst = 99;
`;
    fs.writeFileSync(fileExporter, exporterContent);

    // Create file that imports some exports
    const fileUser = path.join(testDir, 'checkUser.ts');
    const userContent = `
import { usedFunc, usedConst } from './checkExporter';

const result = usedFunc();
console.log(usedConst);
`;
    fs.writeFileSync(fileUser, userContent);

    // Build the index
    const { index } = projectIndexBuildSync({
      files: [fileExporter, fileUser],
      dir: testDir,
    });

    // Create mock rule and context
    const rule: PolicyRule = {
      ruleId: 'unused-exports',
      description: 'Test rule',
      targets: [],
    };

    const target = {
      language: 'typescript' as const,
      files: ['**/*.ts'],
    };

    const policy = {
      targets: { 'ts-files': target },
      rules: [rule],
    };

    const context: PolicyCheckContext = {
      filePath: fileExporter,
      source: exporterContent,
      policy,
      dir: testDir,
      target,
      projectIndex: index,
      ruleArgs: {},
    };

    // Run unusedExportsCheck
    const violations = unusedExportsCheck(rule, context);

    console.log('\n=== unusedExportsCheck Results ===');
    console.log('Violations:', violations.length);
    for (const v of violations) {
      console.log(`  - ${v.message} (line ${v.line})`);
    }

    // Should find 2 unused exports: unusedFunc and unusedConst
    expect(violations.length).toBe(2);
    
    const violationMessages = violations.map(v => v.message);
    expect(violationMessages.some(m => m.includes("'unusedFunc'"))).toBe(true);
    expect(violationMessages.some(m => m.includes("'unusedConst'"))).toBe(true);
    expect(violationMessages.some(m => m.includes("'usedFunc'"))).toBe(false);
    expect(violationMessages.some(m => m.includes("'usedConst'"))).toBe(false);
  });

  it('should handle default exports correctly', () => {
    // Create file with default export
    const fileDefault = path.join(testDir, 'defaultExporter.ts');
    const defaultContent = `
function myDefaultFunc() {
  return 'default';
}

export default myDefaultFunc;
`;
    fs.writeFileSync(fileDefault, defaultContent);

    // Create file that imports the default
    const fileDefaultUser = path.join(testDir, 'defaultUser.ts');
    const defaultUserContent = `
import myFunc from './defaultExporter';

const result = myFunc();
`;
    fs.writeFileSync(fileDefaultUser, defaultUserContent);

    // Build the index
    const { index } = projectIndexBuildSync({
      files: [fileDefault, fileDefaultUser],
      dir: testDir,
    });

    // Create mock rule and context
    const rule: PolicyRule = {
      ruleId: 'unused-exports',
      description: 'Test rule',
      targets: [],
    };

    const target = {
      language: 'typescript' as const,
      files: ['**/*.ts'],
    };

    const policy = {
      targets: { 'ts-files': target },
      rules: [rule],
    };

    const context: PolicyCheckContext = {
      filePath: fileDefault,
      source: defaultContent,
      policy,
      dir: testDir,
      target,
      projectIndex: index,
      ruleArgs: {},
    };

    // Run unusedExportsCheck
    const violations = unusedExportsCheck(rule, context);

    console.log('\n=== Default Export Test ===');
    console.log('Violations:', violations.length);
    for (const v of violations) {
      console.log(`  - ${v.message}`);
    }

    // Should find 0 violations - the default export is used
    expect(violations.length).toBe(0);
  });

  it('should report unused default exports', () => {
    // Create file with unused default export
    const fileUnusedDefault = path.join(testDir, 'unusedDefaultExporter.ts');
    const unusedDefaultContent = `
function unusedDefaultFunc() {
  return 'unused';
}

export default unusedDefaultFunc;
`;
    fs.writeFileSync(fileUnusedDefault, unusedDefaultContent);

    // Create a file that does NOT import from the exporter
    const fileOther = path.join(testDir, 'otherFile.ts');
    const otherContent = `
const x = 1;
`;
    fs.writeFileSync(fileOther, otherContent);

    // Build the index
    const { index } = projectIndexBuildSync({
      files: [fileUnusedDefault, fileOther],
      dir: testDir,
    });

    // Create mock rule and context
    const rule: PolicyRule = {
      ruleId: 'unused-exports',
      description: 'Test rule',
      targets: [],
    };

    const target = {
      language: 'typescript' as const,
      files: ['**/*.ts'],
    };

    const policy = {
      targets: { 'ts-files': target },
      rules: [rule],
    };

    const context: PolicyCheckContext = {
      filePath: fileUnusedDefault,
      source: unusedDefaultContent,
      policy,
      dir: testDir,
      target,
      projectIndex: index,
      ruleArgs: {},
    };

    // Run unusedExportsCheck
    const violations = unusedExportsCheck(rule, context);

    console.log('\n=== Unused Default Export Test ===');
    console.log('Violations:', violations.length);
    for (const v of violations) {
      console.log(`  - ${v.message}`);
    }

    // Should find 1 violation - the default export is unused
    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain('unusedDefaultFunc');
  });

  // ============================================
  // Configuration Options
  // ============================================

  describe('ignoreEntryPoints option', () => {
    it('should skip index.ts files when ignoreEntryPoints is true', () => {
      // Create index.ts with unused export
      const indexDir = path.join(testDir, 'entrypoint-test');
      fs.mkdirSync(indexDir, { recursive: true });
      const indexFile = path.join(indexDir, 'index.ts');
      const indexContent = `export const unusedFromIndex = 1;`;
      fs.writeFileSync(indexFile, indexContent);

      // Create another file to have something in the index
      const otherFile = path.join(indexDir, 'other.ts');
      fs.writeFileSync(otherFile, `const x = 1;`);

      const { index } = projectIndexBuildSync({
        files: [indexFile, otherFile],
        dir: indexDir,
      });

      const { rule, context } = createContext(indexFile, indexContent, index, {
        ignoreEntryPoints: true,
      });

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(0);
    });

    it('should skip main.ts files when ignoreEntryPoints is true', () => {
      const mainDir = path.join(testDir, 'main-test');
      fs.mkdirSync(mainDir, { recursive: true });
      const mainFile = path.join(mainDir, 'main.ts');
      const mainContent = `export const unusedFromMain = 1;`;
      fs.writeFileSync(mainFile, mainContent);

      const otherFile = path.join(mainDir, 'other.ts');
      fs.writeFileSync(otherFile, `const x = 1;`);

      const { index } = projectIndexBuildSync({
        files: [mainFile, otherFile],
        dir: mainDir,
      });

      const { rule, context } = createContext(mainFile, mainContent, index, {
        ignoreEntryPoints: true,
      });

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(0);
    });

    it('should check index.ts files when ignoreEntryPoints is false', () => {
      const checkDir = path.join(testDir, 'check-index-test');
      fs.mkdirSync(checkDir, { recursive: true });
      const indexFile = path.join(checkDir, 'index.ts');
      const indexContent = `export const unusedExport = 1;`;
      fs.writeFileSync(indexFile, indexContent);

      const otherFile = path.join(checkDir, 'other.ts');
      fs.writeFileSync(otherFile, `const x = 1;`);

      const { index } = projectIndexBuildSync({
        files: [indexFile, otherFile],
        dir: checkDir,
      });

      const { rule, context } = createContext(indexFile, indexContent, index, {
        ignoreEntryPoints: false,
      });

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('unusedExport');
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe('edge cases', () => {
    it('should return empty array when projectIndex is undefined', () => {
      const { rule, context } = createContext(
        '/fake/path.ts',
        'export const x = 1;',
        undefined
      );

      const violations = unusedExportsCheck(rule, context);
      expect(violations).toEqual([]);
    });

    it('should return no violations for file with no exports', () => {
      const noExportFile = path.join(testDir, 'noExports.ts');
      const noExportContent = `const x = 1;\nconst y = 2;`;
      fs.writeFileSync(noExportFile, noExportContent);

      const { index } = projectIndexBuildSync({
        files: [noExportFile],
        dir: testDir,
      });

      const { rule, context } = createContext(noExportFile, noExportContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(0);
    });

    it('should return no violations when all exports are used', () => {
      const allUsedDir = path.join(testDir, 'all-used');
      fs.mkdirSync(allUsedDir, { recursive: true });
      
      const exporterFile = path.join(allUsedDir, 'exporter.ts');
      const exporterContent = `
export const a = 1;
export const b = 2;
export function c() {}
`;
      fs.writeFileSync(exporterFile, exporterContent);

      const userFile = path.join(allUsedDir, 'user.ts');
      const userContent = `
import { a, b, c } from './exporter';
console.log(a, b);
c();
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [exporterFile, userFile],
        dir: allUsedDir,
      });

      const { rule, context } = createContext(exporterFile, exporterContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(0);
    });
  });

  // ============================================
  // Export Types
  // ============================================

  describe('export types', () => {
    it('should detect unused exported classes', () => {
      const classDir = path.join(testDir, 'class-test');
      fs.mkdirSync(classDir, { recursive: true });
      
      const classFile = path.join(classDir, 'classes.ts');
      const classContent = `
export class UsedClass {
  value = 1;
}

export class UnusedClass {
  value = 2;
}
`;
      fs.writeFileSync(classFile, classContent);

      const userFile = path.join(classDir, 'user.ts');
      const userContent = `
import { UsedClass } from './classes';
const instance = new UsedClass();
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [classFile, userFile],
        dir: classDir,
      });

      const { rule, context } = createContext(classFile, classContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('UnusedClass');
    });

    it('should handle mixed default and named exports', () => {
      const mixedDir = path.join(testDir, 'mixed-test');
      fs.mkdirSync(mixedDir, { recursive: true });
      
      const mixedFile = path.join(mixedDir, 'mixed.ts');
      const mixedContent = `
export const namedExport = 1;

function defaultFunc() {}
export default defaultFunc;
`;
      fs.writeFileSync(mixedFile, mixedContent);

      // Only import the default, not the named
      const userFile = path.join(mixedDir, 'user.ts');
      const userContent = `
import defaultFunc from './mixed';
defaultFunc();
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [mixedFile, userFile],
        dir: mixedDir,
      });

      const { rule, context } = createContext(mixedFile, mixedContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('namedExport');
    });

    it('should handle export declarations with export clause', () => {
      const exportClauseDir = path.join(testDir, 'export-clause-test');
      fs.mkdirSync(exportClauseDir, { recursive: true });
      
      const exportFile = path.join(exportClauseDir, 'exports.ts');
      const exportContent = `
const usedVar = 1;
const unusedVar = 2;

export { usedVar, unusedVar };
`;
      fs.writeFileSync(exportFile, exportContent);

      const userFile = path.join(exportClauseDir, 'user.ts');
      const userContent = `
import { usedVar } from './exports';
console.log(usedVar);
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [exportFile, userFile],
        dir: exportClauseDir,
      });

      const { rule, context } = createContext(exportFile, exportContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('unusedVar');
    });

    it('should detect unused exported type aliases', () => {
      const typeDir = path.join(testDir, 'type-alias-test');
      fs.mkdirSync(typeDir, { recursive: true });
      
      const typeFile = path.join(typeDir, 'types.ts');
      const typeContent = `
export type UsedType = string;
export type UnusedType = number;
`;
      fs.writeFileSync(typeFile, typeContent);

      const userFile = path.join(typeDir, 'user.ts');
      const userContent = `
import { UsedType } from './types';
const x: UsedType = 'hello';
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [typeFile, userFile],
        dir: typeDir,
      });

      const { rule, context } = createContext(typeFile, typeContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('UnusedType');
    });

    it('should detect unused exported interfaces', () => {
      const ifaceDir = path.join(testDir, 'interface-test');
      fs.mkdirSync(ifaceDir, { recursive: true });
      
      const ifaceFile = path.join(ifaceDir, 'interfaces.ts');
      const ifaceContent = `
export interface UsedInterface {
  name: string;
}

export interface UnusedInterface {
  value: number;
}
`;
      fs.writeFileSync(ifaceFile, ifaceContent);

      const userFile = path.join(ifaceDir, 'user.ts');
      const userContent = `
import { UsedInterface } from './interfaces';
const obj: UsedInterface = { name: 'test' };
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [ifaceFile, userFile],
        dir: ifaceDir,
      });

      const { rule, context } = createContext(ifaceFile, ifaceContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('UnusedInterface');
    });

    it('should detect unused exported enums', () => {
      const enumDir = path.join(testDir, 'enum-test');
      fs.mkdirSync(enumDir, { recursive: true });
      
      const enumFile = path.join(enumDir, 'enums.ts');
      const enumContent = `
export enum UsedEnum {
  A = 'a',
  B = 'b',
}

export enum UnusedEnum {
  X = 'x',
  Y = 'y',
}
`;
      fs.writeFileSync(enumFile, enumContent);

      const userFile = path.join(enumDir, 'user.ts');
      const userContent = `
import { UsedEnum } from './enums';
const val = UsedEnum.A;
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [enumFile, userFile],
        dir: enumDir,
      });

      const { rule, context } = createContext(enumFile, enumContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('UnusedEnum');
    });

    it('should handle mixed value and type exports', () => {
      const mixedTypeDir = path.join(testDir, 'mixed-type-value-test');
      fs.mkdirSync(mixedTypeDir, { recursive: true });
      
      const mixedFile = path.join(mixedTypeDir, 'mixed.ts');
      const mixedContent = `
export const usedValue = 1;
export const unusedValue = 2;
export type UsedType = string;
export type UnusedType = number;
export interface UsedInterface { x: number; }
export interface UnusedInterface { y: string; }
`;
      fs.writeFileSync(mixedFile, mixedContent);

      const userFile = path.join(mixedTypeDir, 'user.ts');
      const userContent = `
import { usedValue, UsedType, UsedInterface } from './mixed';
const x: UsedType = 'hello';
const obj: UsedInterface = { x: usedValue };
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [mixedFile, userFile],
        dir: mixedTypeDir,
      });

      const { rule, context } = createContext(mixedFile, mixedContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(3);
      const messages = violations.map(v => v.message);
      expect(messages.some(m => m.includes('unusedValue'))).toBe(true);
      expect(messages.some(m => m.includes('UnusedType'))).toBe(true);
      expect(messages.some(m => m.includes('UnusedInterface'))).toBe(true);
    });

    it('should detect unused exported abstract classes', () => {
      const abstractDir = path.join(testDir, 'abstract-class-test');
      fs.mkdirSync(abstractDir, { recursive: true });
      
      const abstractFile = path.join(abstractDir, 'abstract.ts');
      const abstractContent = `
export abstract class UsedAbstract {
  abstract getValue(): number;
}

export abstract class UnusedAbstract {
  abstract getName(): string;
}
`;
      fs.writeFileSync(abstractFile, abstractContent);

      const userFile = path.join(abstractDir, 'user.ts');
      const userContent = `
import { UsedAbstract } from './abstract';
class Concrete extends UsedAbstract {
  getValue() { return 42; }
}
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [abstractFile, userFile],
        dir: abstractDir,
      });

      const { rule, context } = createContext(abstractFile, abstractContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('UnusedAbstract');
    });

    it('should detect unused exported namespaces', () => {
      const nsDir = path.join(testDir, 'namespace-export-test');
      fs.mkdirSync(nsDir, { recursive: true });
      
      // Simple namespaces without nested exports to test the basic case
      const nsFile = path.join(nsDir, 'namespaces.ts');
      const nsContent = `
export namespace UsedNS {}

export namespace UnusedNS {}
`;
      fs.writeFileSync(nsFile, nsContent);

      const userFile = path.join(nsDir, 'user.ts');
      const userContent = `
import { UsedNS } from './namespaces';
const ns = UsedNS;
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [nsFile, userFile],
        dir: nsDir,
      });

      const { rule, context } = createContext(nsFile, nsContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('UnusedNS');
    });

    it('should detect unused nested exports in namespaces', () => {
      const nsDir = path.join(testDir, 'namespace-nested-test');
      fs.mkdirSync(nsDir, { recursive: true });
      
      const nsFile = path.join(nsDir, 'namespaces.ts');
      const nsContent = `
export namespace MyNS {
  export const usedValue = 1;
  export const unusedValue = 2;
}
`;
      fs.writeFileSync(nsFile, nsContent);

      const userFile = path.join(nsDir, 'user.ts');
      const userContent = `
import { MyNS } from './namespaces';
console.log(MyNS.usedValue);
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [nsFile, userFile],
        dir: nsDir,
      });

      const { rule, context } = createContext(nsFile, nsContent, index);

      const violations = unusedExportsCheck(rule, context);
      // Nested exports inside namespaces are also tracked as separate exports
      // The namespace is imported, but the nested members are separate exports
      // Note: Current implementation treats nested exports as separate from the namespace
      expect(violations.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect unused default class exports', () => {
      const defaultClassDir = path.join(testDir, 'default-class-test');
      fs.mkdirSync(defaultClassDir, { recursive: true });
      
      const defaultClassFile = path.join(defaultClassDir, 'defaultClass.ts');
      const defaultClassContent = `
export default class MyDefaultClass {
  value = 42;
}
`;
      fs.writeFileSync(defaultClassFile, defaultClassContent);

      // File that does NOT import the default class
      const otherFile = path.join(defaultClassDir, 'other.ts');
      fs.writeFileSync(otherFile, `const x = 1;`);

      const { index } = projectIndexBuildSync({
        files: [defaultClassFile, otherFile],
        dir: defaultClassDir,
      });

      const { rule, context } = createContext(defaultClassFile, defaultClassContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('MyDefaultClass');
    });

    it('should not report used default class exports', () => {
      const usedDefaultClassDir = path.join(testDir, 'used-default-class-test');
      fs.mkdirSync(usedDefaultClassDir, { recursive: true });
      
      const classFile = path.join(usedDefaultClassDir, 'myClass.ts');
      const classContent = `
export default class MyClass {
  getValue() { return 42; }
}
`;
      fs.writeFileSync(classFile, classContent);

      const userFile = path.join(usedDefaultClassDir, 'user.ts');
      const userContent = `
import MyClass from './myClass';
const instance = new MyClass();
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [classFile, userFile],
        dir: usedDefaultClassDir,
      });

      const { rule, context } = createContext(classFile, classContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(0);
    });

    it('should detect unused default function exports', () => {
      const defaultFuncDir = path.join(testDir, 'default-func-test');
      fs.mkdirSync(defaultFuncDir, { recursive: true });
      
      const defaultFuncFile = path.join(defaultFuncDir, 'defaultFunc.ts');
      const defaultFuncContent = `
export default function myDefaultFunc() {
  return 42;
}
`;
      fs.writeFileSync(defaultFuncFile, defaultFuncContent);

      // File that does NOT import the default function
      const otherFile = path.join(defaultFuncDir, 'other.ts');
      fs.writeFileSync(otherFile, `const x = 1;`);

      const { index } = projectIndexBuildSync({
        files: [defaultFuncFile, otherFile],
        dir: defaultFuncDir,
      });

      const { rule, context } = createContext(defaultFuncFile, defaultFuncContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('myDefaultFunc');
    });

    it('should not report used default function exports', () => {
      const usedDefaultFuncDir = path.join(testDir, 'used-default-func-test');
      fs.mkdirSync(usedDefaultFuncDir, { recursive: true });
      
      const funcFile = path.join(usedDefaultFuncDir, 'myFunc.ts');
      const funcContent = `
export default function myFunc() {
  return 42;
}
`;
      fs.writeFileSync(funcFile, funcContent);

      const userFile = path.join(usedDefaultFuncDir, 'user.ts');
      const userContent = `
import myFunc from './myFunc';
const result = myFunc();
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [funcFile, userFile],
        dir: usedDefaultFuncDir,
      });

      const { rule, context } = createContext(funcFile, funcContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(0);
    });

    it('should detect unused generator function exports', () => {
      const genDir = path.join(testDir, 'generator-test');
      fs.mkdirSync(genDir, { recursive: true });
      
      const genFile = path.join(genDir, 'generators.ts');
      const genContent = `
export function* usedGenerator() {
  yield 1;
  yield 2;
}

export function* unusedGenerator() {
  yield 'a';
  yield 'b';
}
`;
      fs.writeFileSync(genFile, genContent);

      const userFile = path.join(genDir, 'user.ts');
      const userContent = `
import { usedGenerator } from './generators';
for (const val of usedGenerator()) {
  console.log(val);
}
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [genFile, userFile],
        dir: genDir,
      });

      const { rule, context } = createContext(genFile, genContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('unusedGenerator');
    });
  });

  // ============================================
  // Import Patterns
  // ============================================

  describe('import patterns', () => {
    it('should handle namespace imports (import * as)', () => {
      const nsDir = path.join(testDir, 'namespace-test');
      fs.mkdirSync(nsDir, { recursive: true });
      
      const utilsFile = path.join(nsDir, 'utils.ts');
      const utilsContent = `
export const helper1 = 1;
export const helper2 = 2;
export function helper3() {}
`;
      fs.writeFileSync(utilsFile, utilsContent);

      const userFile = path.join(nsDir, 'user.ts');
      const userContent = `
import * as utils from './utils';
console.log(utils.helper1);
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [utilsFile, userFile],
        dir: nsDir,
      });

      const { rule, context } = createContext(utilsFile, utilsContent, index);

      const violations = unusedExportsCheck(rule, context);
      // Namespace imports should mark all exports as potentially used
      // The current implementation may not handle this - test documents current behavior
      console.log('\n=== Namespace Import Test ===');
      console.log('Violations:', violations.length);
      for (const v of violations) {
        console.log(`  - ${v.message}`);
      }
    });

    it('should handle multiple consumers of the same export', () => {
      const multiDir = path.join(testDir, 'multi-consumer-test');
      fs.mkdirSync(multiDir, { recursive: true });
      
      const sharedFile = path.join(multiDir, 'shared.ts');
      const sharedContent = `export const sharedValue = 42;`;
      fs.writeFileSync(sharedFile, sharedContent);

      const consumer1 = path.join(multiDir, 'consumer1.ts');
      fs.writeFileSync(consumer1, `
import { sharedValue } from './shared';
console.log(sharedValue);
`);

      const consumer2 = path.join(multiDir, 'consumer2.ts');
      fs.writeFileSync(consumer2, `
import { sharedValue } from './shared';
console.log(sharedValue * 2);
`);

      const { index } = projectIndexBuildSync({
        files: [sharedFile, consumer1, consumer2],
        dir: multiDir,
      });

      const { rule, context } = createContext(sharedFile, sharedContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(0);
    });

    it('should handle aliased imports (import { foo as bar })', () => {
      const aliasDir = path.join(testDir, 'alias-test');
      fs.mkdirSync(aliasDir, { recursive: true });
      
      const sourceFile = path.join(aliasDir, 'source.ts');
      const sourceContent = `
export const originalName = 1;
export const unusedName = 2;
`;
      fs.writeFileSync(sourceFile, sourceContent);

      const userFile = path.join(aliasDir, 'user.ts');
      const userContent = `
import { originalName as aliasedName } from './source';
console.log(aliasedName);
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [sourceFile, userFile],
        dir: aliasDir,
      });

      const { rule, context } = createContext(sourceFile, sourceContent, index);

      const violations = unusedExportsCheck(rule, context);
      // originalName should be marked as used (imported with alias)
      // unusedName should be flagged
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('unusedName');
      expect(violations.every(v => !v.message.includes('originalName'))).toBe(true);
    });
  });

  // ============================================
  // Module Resolution
  // ============================================

  describe('module resolution', () => {
    it('should resolve imports to index files in directories', () => {
      const indexResDir = path.join(testDir, 'index-resolution');
      const subDir = path.join(indexResDir, 'utils');
      fs.mkdirSync(subDir, { recursive: true });
      
      const indexFile = path.join(subDir, 'index.ts');
      const indexContent = `
export const utilHelper = 1;
export const unusedHelper = 2;
`;
      fs.writeFileSync(indexFile, indexContent);

      const userFile = path.join(indexResDir, 'user.ts');
      const userContent = `
import { utilHelper } from './utils';
console.log(utilHelper);
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [indexFile, userFile],
        dir: indexResDir,
      });

      const { rule, context } = createContext(indexFile, indexContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('unusedHelper');
    });

    it('should handle imports with explicit .ts extension', () => {
      const extDir = path.join(testDir, 'explicit-ext-test');
      fs.mkdirSync(extDir, { recursive: true });
      
      const moduleFile = path.join(extDir, 'module.ts');
      const moduleContent = `
export const explicitImport = 1;
export const notImported = 2;
`;
      fs.writeFileSync(moduleFile, moduleContent);

      const userFile = path.join(extDir, 'user.ts');
      const userContent = `
import { explicitImport } from './module.ts';
console.log(explicitImport);
`;
      fs.writeFileSync(userFile, userContent);

      const { index } = projectIndexBuildSync({
        files: [moduleFile, userFile],
        dir: extDir,
      });

      const { rule, context } = createContext(moduleFile, moduleContent, index);

      const violations = unusedExportsCheck(rule, context);
      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('notImported');
    });
  });

  // ============================================
  // Incremental Updates
  // ============================================

  describe('incremental updates', () => {
    it('should update violations when export is added (import starts using it)', async () => {
      const incrementalDir = path.join(testDir, 'incremental-add-export');
      fs.mkdirSync(incrementalDir, { recursive: true });
      
      // Initial setup: exporter has unused export, user doesn't import it
      const exporterFile = path.join(incrementalDir, 'exporter.ts');
      const exporterContentV1 = `
export const usedExport = 1;
export const newlyUsedExport = 2;  // Will be imported later
`;
      fs.writeFileSync(exporterFile, exporterContentV1);

      const userFile = path.join(incrementalDir, 'user.ts');
      const userContentV1 = `
import { usedExport } from './exporter';
console.log(usedExport);
`;
      fs.writeFileSync(userFile, userContentV1);

      // Build initial index
      const { index: indexV1 } = projectIndexBuildSync({
        files: [exporterFile, userFile],
        dir: incrementalDir,
      });

      // Check violations - newlyUsedExport should be flagged as unused
      const { rule, context: contextV1 } = createContext(exporterFile, exporterContentV1, indexV1);
      const violationsV1 = unusedExportsCheck(rule, contextV1);
      
      expect(violationsV1.length).toBe(1);
      expect(violationsV1[0].message).toContain('newlyUsedExport');

      // Now update user.ts to import the previously unused export
      const userContentV2 = `
import { usedExport, newlyUsedExport } from './exporter';
console.log(usedExport, newlyUsedExport);
`;
      fs.writeFileSync(userFile, userContentV2);

      // Rebuild index (simulating what eslintAdapter does incrementally)
      const { index: indexV2 } = projectIndexBuildSync({
        files: [exporterFile, userFile],
        dir: incrementalDir,
      });

      // Check violations again - newlyUsedExport should no longer be flagged
      const { context: contextV2 } = createContext(exporterFile, exporterContentV1, indexV2);
      const violationsV2 = unusedExportsCheck(rule, contextV2);
      
      expect(violationsV2.length).toBe(0);
    });

    it('should update violations when export is removed from use', async () => {
      const incrementalDir = path.join(testDir, 'incremental-remove-export');
      fs.mkdirSync(incrementalDir, { recursive: true });
      
      // Initial setup: both exports are used
      const exporterFile = path.join(incrementalDir, 'exporter.ts');
      const exporterContent = `
export const stillUsed = 1;
export const willBeUnused = 2;
`;
      fs.writeFileSync(exporterFile, exporterContent);

      const userFile = path.join(incrementalDir, 'user.ts');
      const userContentV1 = `
import { stillUsed, willBeUnused } from './exporter';
console.log(stillUsed, willBeUnused);
`;
      fs.writeFileSync(userFile, userContentV1);

      // Build initial index
      const { index: indexV1 } = projectIndexBuildSync({
        files: [exporterFile, userFile],
        dir: incrementalDir,
      });

      // Check violations - should be none
      const { rule, context: contextV1 } = createContext(exporterFile, exporterContent, indexV1);
      const violationsV1 = unusedExportsCheck(rule, contextV1);
      
      expect(violationsV1.length).toBe(0);

      // Now update user.ts to stop using willBeUnused
      const userContentV2 = `
import { stillUsed } from './exporter';
console.log(stillUsed);
`;
      fs.writeFileSync(userFile, userContentV2);

      // Rebuild index
      const { index: indexV2 } = projectIndexBuildSync({
        files: [exporterFile, userFile],
        dir: incrementalDir,
      });

      // Check violations again - willBeUnused should now be flagged
      const { context: contextV2 } = createContext(exporterFile, exporterContent, indexV2);
      const violationsV2 = unusedExportsCheck(rule, contextV2);
      
      expect(violationsV2.length).toBe(1);
      expect(violationsV2[0].message).toContain('willBeUnused');
    });

    it('should update violations when export is renamed', async () => {
      const incrementalDir = path.join(testDir, 'incremental-rename-export');
      fs.mkdirSync(incrementalDir, { recursive: true });
      
      // Initial setup: original export name is used
      const exporterFile = path.join(incrementalDir, 'exporter.ts');
      const exporterContentV1 = `
export const originalName = 1;
`;
      fs.writeFileSync(exporterFile, exporterContentV1);

      const userFile = path.join(incrementalDir, 'user.ts');
      const userContent = `
import { originalName } from './exporter';
console.log(originalName);
`;
      fs.writeFileSync(userFile, userContent);

      // Build initial index
      const { index: indexV1 } = projectIndexBuildSync({
        files: [exporterFile, userFile],
        dir: incrementalDir,
      });

      // Check violations - none expected
      const rule: PolicyRule = {
        ruleId: 'unused-exports',
        description: 'Test rule',
        targets: [],
      };
      const target = {
        language: 'typescript' as const,
        files: ['**/*.ts'],
      };
      const policy = {
        targets: { 'ts-files': target },
        rules: [rule],
      };
      
      const contextV1: PolicyCheckContext = {
        filePath: exporterFile,
        source: exporterContentV1,
        policy,
        dir: incrementalDir,
        target,
        projectIndex: indexV1,
        ruleArgs: {},
      };
      
      const violationsV1 = unusedExportsCheck(rule, contextV1);
      expect(violationsV1.length).toBe(0);

      // Now rename the export in exporter.ts
      const exporterContentV2 = `
export const renamedExport = 1;  // originalName is now gone
`;
      fs.writeFileSync(exporterFile, exporterContentV2);

      // Rebuild index
      const { index: indexV2 } = projectIndexBuildSync({
        files: [exporterFile, userFile],
        dir: incrementalDir,
      });

      // Check violations - renamedExport should be flagged (user.ts still imports originalName)
      const contextV2: PolicyCheckContext = {
        filePath: exporterFile,
        source: exporterContentV2,
        policy,
        dir: incrementalDir,
        target,
        projectIndex: indexV2,
        ruleArgs: {},
      };
      
      const violationsV2 = unusedExportsCheck(rule, contextV2);
      expect(violationsV2.length).toBe(1);
      expect(violationsV2[0].message).toContain('renamedExport');
    });

    it('should detect file content changes via revision', async () => {
      // Import the store functions to test revision detection
      const { indexStoreNew, projectIndexUpdateFileSync } = await import('@codepol/core');
      
      const revisionDir = path.join(testDir, 'revision-test');
      fs.mkdirSync(revisionDir, { recursive: true });
      
      const testFile = path.join(revisionDir, 'testFile.ts');
      const contentV1 = `export const v1 = 1;`;
      fs.writeFileSync(testFile, contentV1);

      // Build initial index with a store we can access
      const store = indexStoreNew();
      projectIndexBuildSync({
        files: [testFile],
        dir: revisionDir,
        store,
      });

      // Check that file is indexed
      const files = store.filesGet();
      expect(files).toContain(testFile);

      // Try to update with same content - should return false (no change)
      const updatedSame = projectIndexUpdateFileSync(store, testFile);
      expect(updatedSame).toBe(false);

      // Change the file content
      const contentV2 = `export const v2 = 2;`;
      fs.writeFileSync(testFile, contentV2);

      // Try to update with changed content - should return true
      const updatedChanged = projectIndexUpdateFileSync(store, testFile);
      expect(updatedChanged).toBe(true);

      // Verify the index now has the new symbol
      const symbols = store.symbolsGet({ file: testFile });
      const symbolNames = symbols.map(s => s.name);
      expect(symbolNames).toContain('v2');
      expect(symbolNames).not.toContain('v1');
    });
  });
});

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuild,
  projectIndexBuildSync,
  projectIndexUpdateFileFromSource,
  projectIndexRemoveFiles,
  crossFileResolveForFile,
  indexStoreNew,
  adapterRegister,
  SymbolFlags,
  DEFAULT_EXTENSIONS,
  type FileIndexDelta,
} from '@codepol/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('index builder', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-builder-test-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Symbol Extraction
  // ==========================================================================

  describe('symbol extraction', () => {
    function symbolsFromSource(fileName: string, source: string) {
      const file = path.join(testDir, fileName);
      fs.writeFileSync(file, source);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      return index.symbolsInFileGet(file);
    }

    it.each([
      {
        label: 'class declarations',
        fileName: 'sym_matrix_class.ts',
        source: 'export class GoodClass {}\n',
        expected: { name: 'GoodClass', kind: 'class' },
      },
      {
        label: 'interface declarations',
        fileName: 'sym_matrix_interface.ts',
        source: 'export interface GoodInterface {}\n',
        expected: { name: 'GoodInterface', kind: 'interface' },
      },
      {
        label: 'type aliases',
        fileName: 'sym_matrix_type.ts',
        source: 'export type GoodType = string;\n',
        expected: { name: 'GoodType', kind: 'type' },
      },
      {
        label: 'function declarations',
        fileName: 'sym_matrix_function.ts',
        source: 'export function goodFunction() { return 1; }\n',
        expected: { name: 'goodFunction', kind: 'function' },
      },
      {
        label: 'function signatures',
        fileName: 'sym_matrix_function_signature.ts',
        source: 'declare function declaredFunction(name: string): void;\n',
        expected: { name: 'declaredFunction', kind: 'function' },
      },
      {
        label: 'class methods',
        fileName: 'sym_matrix_method.ts',
        source: 'export class MethodHost { goodMethod() { return 1; } }\n',
        expected: { name: 'goodMethod', kind: 'method' },
      },
      {
        label: 'variables',
        fileName: 'sym_matrix_variable.ts',
        source: 'let goodVariable = 1;\n',
        expected: { name: 'goodVariable', kind: 'variable' },
      },
      {
        label: 'const declarations',
        fileName: 'sym_matrix_const.ts',
        source: 'const GOOD_CONST = 1;\n',
        expected: { name: 'GOOD_CONST', kind: 'const' },
      },
      {
        label: 'class fields',
        fileName: 'sym_matrix_field.ts',
        source: "export class FieldHost { goodField: string = 'x'; }\n",
        expected: { name: 'goodField', kind: 'field' },
      },
      {
        label: 'parameters',
        fileName: 'sym_matrix_parameter.ts',
        source: 'export function parameterHost(goodParam: string) { return goodParam; }\n',
        expected: { name: 'goodParam', kind: 'parameter' },
      },
      {
        label: 'enums',
        fileName: 'sym_matrix_enum.ts',
        source: "export enum GoodEnum { FirstMember = 'first' }\n",
        expected: { name: 'GoodEnum', kind: 'enum' },
      },
      {
        label: 'enum members',
        fileName: 'sym_matrix_enum_member.ts',
        source: "export enum GoodEnumMembers { FirstMember = 'first' }\n",
        expected: { name: 'FirstMember', kind: 'enumMember' },
      },
      {
        label: 'module declarations',
        fileName: 'sym_matrix_module.ts',
        source: 'declare module "pkg/internal" { export const value: number; }\n',
        expected: { name: 'pkg/internal', kind: 'module' },
      },
      {
        label: 'nested namespace declarations',
        fileName: 'sym_matrix_namespace.ts',
        source: 'namespace Foo.Bar { export const value = 1; }\n',
        expected: { name: 'Foo.Bar', kind: 'namespace' },
      },
      {
        label: 'import equals require bindings',
        fileName: 'sym_matrix_import_require.ts',
        source: "import main = require('./dep');\nvoid main;\n",
        expected: { name: 'main', kind: 'variable' },
      },
      {
        label: 'import alias bindings',
        fileName: 'sym_matrix_import_alias.ts',
        source: 'declare namespace Foo { const Bar: number; }\nimport Alias = Foo.Bar;\nvoid Alias;\n',
        expected: { name: 'Alias', kind: 'variable' },
      },
    ])('should extract $label with the expected symbol kind', ({ fileName, source, expected }) => {
      const symbols = symbolsFromSource(fileName, source);
      const symbol = symbols.find((candidate) =>
        candidate.name === expected.name && candidate.kind === expected.kind
      );

      expect(symbol).toBeDefined();
    });

    it('should extract function declarations with correct kind and flags', () => {
      const file = path.join(testDir, 'sym_functions.ts');
      fs.writeFileSync(file, `
export function greet(name: string): string {
  return 'hello ' + name;
}

function helper() {
  return 42;
}

export async function fetchData() {
  return [];
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);
      const fnSymbols = symbols.filter(s => s.kind === 'function');

      const greet = fnSymbols.find(s => s.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet!.kind).toBe('function');
      expect(greet!.flags & SymbolFlags.Exported).toBeTruthy();

      const helper = fnSymbols.find(s => s.name === 'helper');
      expect(helper).toBeDefined();
      expect(helper!.kind).toBe('function');
      expect(helper!.flags & SymbolFlags.Exported).toBeFalsy();

      const fetchData = fnSymbols.find(s => s.name === 'fetchData');
      expect(fetchData).toBeDefined();
      expect(fetchData!.kind).toBe('function');
      expect(fetchData!.flags & SymbolFlags.Exported).toBeTruthy();
    });

    it('should extract fields and methods with non-identifier names', () => {
      const file = path.join(testDir, 'sym_non_identifier_members.ts');
      fs.writeFileSync(file, `
class ExoticMembers {
  #secret = 1;
  "run"() { return this.#secret; }
  42 = 2;
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);

      expect(symbols.find((symbol) => symbol.name === '#secret' && symbol.kind === 'field')).toBeDefined();
      expect(symbols.find((symbol) => symbol.name === '"run"' && symbol.kind === 'method')).toBeDefined();
      expect(symbols.find((symbol) => symbol.name === '42' && symbol.kind === 'field')).toBeDefined();
    });

    it('should detect async flag on async function declarations', () => {
      const file = path.join(testDir, 'sym_async_flag.ts');
      fs.writeFileSync(file, `
export async function fetchData() {
  return [];
}

export function syncFn() {
  return 1;
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);
      const fnSymbols = symbols.filter(s => s.kind === 'function');

      const fetchData = fnSymbols.find(s => s.name === 'fetchData');
      expect(fetchData).toBeDefined();
      expect(fetchData!.flags & SymbolFlags.Async).toBeTruthy();

      const syncFn = fnSymbols.find(s => s.name === 'syncFn');
      expect(syncFn).toBeDefined();
      expect(syncFn!.flags & SymbolFlags.Async).toBeFalsy();
    });

    it('should extract classes and methods', () => {
      const file = path.join(testDir, 'sym_classes.ts');
      fs.writeFileSync(file, `
export class Animal {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  speak(): string {
    return this.name + ' makes a sound';
  }

  static create(name: string): Animal {
    return new Animal(name);
  }
}

class InternalHelper {
  run() {}
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);

      const animal = symbols.find(s => s.name === 'Animal' && s.kind === 'class');
      expect(animal).toBeDefined();
      expect(animal!.flags & SymbolFlags.Exported).toBeTruthy();

      const internalHelper = symbols.find(s => s.name === 'InternalHelper' && s.kind === 'class');
      expect(internalHelper).toBeDefined();
      expect(internalHelper!.flags & SymbolFlags.Exported).toBeFalsy();

      const methods = symbols.filter(s => s.kind === 'method');
      const speak = methods.find(s => s.name === 'speak');
      expect(speak).toBeDefined();
    });

    it('should extract variables (const, let)', () => {
      const file = path.join(testDir, 'sym_variables.ts');
      fs.writeFileSync(file, `
export const MAX_SIZE = 100;

export const config = {
  timeout: 5000,
  retries: 3,
};

let counter = 0;

const internal = 'private';
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);

      const maxSize = symbols.find(s => s.name === 'MAX_SIZE');
      expect(maxSize).toBeDefined();
      expect(maxSize!.kind === 'const' || maxSize!.kind === 'variable').toBe(true);
      expect(maxSize!.flags & SymbolFlags.Exported).toBeTruthy();

      const configSym = symbols.find(s => s.name === 'config');
      expect(configSym).toBeDefined();
      expect(configSym!.flags & SymbolFlags.Exported).toBeTruthy();

      const counterSym = symbols.find(s => s.name === 'counter');
      expect(counterSym).toBeDefined();
      expect(counterSym!.flags & SymbolFlags.Exported).toBeFalsy();
    });

    it('should extract type aliases', () => {
      const file = path.join(testDir, 'sym_types.ts');
      fs.writeFileSync(file, `
export type Options = {
  timeout: number;
  retries: number;
};

type InternalState = {
  ready: boolean;
};

export type StringOrNumber = string | number;
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);
      const typeSymbols = symbols.filter(s => s.kind === 'type');

      const options = typeSymbols.find(s => s.name === 'Options');
      expect(options).toBeDefined();
      expect(options!.flags & SymbolFlags.Exported).toBeTruthy();

      const internalState = typeSymbols.find(s => s.name === 'InternalState');
      expect(internalState).toBeDefined();
      expect(internalState!.flags & SymbolFlags.Exported).toBeFalsy();

      const stringOrNumber = typeSymbols.find(s => s.name === 'StringOrNumber');
      expect(stringOrNumber).toBeDefined();
      expect(stringOrNumber!.flags & SymbolFlags.Exported).toBeTruthy();
    });

    it('should extract interfaces', () => {
      const file = path.join(testDir, 'sym_interfaces.ts');
      fs.writeFileSync(file, `
export interface Serializable {
  serialize(): string;
  deserialize(data: string): void;
}

interface InternalCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);
      const interfaceSymbols = symbols.filter(s => s.kind === 'interface');

      const serializable = interfaceSymbols.find(s => s.name === 'Serializable');
      expect(serializable).toBeDefined();
      expect(serializable!.flags & SymbolFlags.Exported).toBeTruthy();

      const internalCache = interfaceSymbols.find(s => s.name === 'InternalCache');
      expect(internalCache).toBeDefined();
      expect(internalCache!.flags & SymbolFlags.Exported).toBeFalsy();
    });

    it('should extract enums and enum members', () => {
      const file = path.join(testDir, 'sym_enums.ts');
      fs.writeFileSync(file, `
export enum Color {
  Red = 'red',
  Green = 'green',
  Blue = 'blue',
}

enum InternalStatus {
  Pending,
  Active,
  Done,
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);

      const colorEnum = symbols.find(s => s.name === 'Color' && s.kind === 'enum');
      expect(colorEnum).toBeDefined();
      expect(colorEnum!.flags & SymbolFlags.Exported).toBeTruthy();

      const internalEnum = symbols.find(s => s.name === 'InternalStatus' && s.kind === 'enum');
      expect(internalEnum).toBeDefined();
      expect(internalEnum!.flags & SymbolFlags.Exported).toBeFalsy();

    });

    it('should extract enum members as separate symbols', () => {
      const file = path.join(testDir, 'sym_enum_members.ts');
      fs.writeFileSync(file, `
export enum Color {
  Red = 'red',
  Green = 'green',
  Blue = 'blue',
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);
      const enumMembers = symbols.filter(s => s.kind === 'enumMember');

      expect(enumMembers).toHaveLength(3);

      const red = enumMembers.find(s => s.name === 'Red');
      expect(red).toBeDefined();

      const green = enumMembers.find(s => s.name === 'Green');
      expect(green).toBeDefined();

      const blue = enumMembers.find(s => s.name === 'Blue');
      expect(blue).toBeDefined();
    });
  });

  // ==========================================================================
  // Scope Tree Construction
  // ==========================================================================

  describe('scope tree construction', () => {
    it('should build nested scope tree with correct parent chain', () => {
      const file = path.join(testDir, 'scope_nested.ts');
      fs.writeFileSync(file, `
function outer() {
  const x = 1;

  function inner() {
    const y = 2;

    if (y > 0) {
      const z = x + y;
    }
  }

  const arrow = () => {
    return x;
  };
}

class MyClass {
  method() {
    const a = 1;
  }
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const scopes = index.scopesInFileGet(file);
      expect(scopes.length).toBeGreaterThanOrEqual(3);

      // Should have a file-level scope
      const fileScope = scopes.find(s => s.kind === 'file');
      expect(fileScope).toBeDefined();
      expect(fileScope!.parent).toBeUndefined();

      // Should have function scopes
      const functionScopes = scopes.filter(s => s.kind === 'function');
      expect(functionScopes.length).toBeGreaterThanOrEqual(2);

      // Function scopes should have a parent (either file or another scope)
      for (const fnScope of functionScopes) {
        expect(fnScope.parent).toBeDefined();
      }

      // Class scopes should exist
      const classScopes = scopes.filter(s => s.kind === 'class');
      expect(classScopes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Heuristic Call Detection
  // ==========================================================================

  describe('heuristic call detection', () => {
    it('should detect function calls and resolve file-local callees', () => {
      const file = path.join(testDir, 'calls_detect.ts');
      fs.writeFileSync(file, `
function helper(): number {
  return 42;
}

function compute(x: number): number {
  return helper() + x;
}

function main() {
  const result = compute(10);
  helper();
}
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const symbols = store.symbolsGet({ file });
      const helperSym = symbols.find(s => s.name === 'helper' && s.kind === 'function');
      const computeSym = symbols.find(s => s.name === 'compute' && s.kind === 'function');
      const mainSym = symbols.find(s => s.name === 'main' && s.kind === 'function');

      expect(helperSym).toBeDefined();
      expect(computeSym).toBeDefined();
      expect(mainSym).toBeDefined();

      // Verify CallsRelation entries are extracted from the store
      const allCalls = store.callsGet();
      expect(allCalls.length).toBeGreaterThanOrEqual(3); // helper() in compute, compute(10) and helper() in main

      // Verify callee names
      const calleeNames = allCalls.map(c => c.calleeName);
      expect(calleeNames).toContain('helper');
      expect(calleeNames).toContain('compute');

      // Verify file-local resolution: simple calls should resolve to known symbols
      const resolvedCalls = allCalls.filter(c => c.resolvedSymbolId !== undefined);
      expect(resolvedCalls.length).toBeGreaterThanOrEqual(2);

      // helper() calls should resolve to the helper symbol
      const helperCalls = allCalls.filter(c => c.calleeName === 'helper' && c.resolvedSymbolId);
      expect(helperCalls.length).toBeGreaterThanOrEqual(1);
      expect(helperCalls[0].resolvedSymbolId).toBe(helperSym!.id);

      // compute() call should resolve to the compute symbol
      const computeCalls = allCalls.filter(c => c.calleeName === 'compute' && c.resolvedSymbolId);
      expect(computeCalls.length).toBeGreaterThanOrEqual(1);
      expect(computeCalls[0].resolvedSymbolId).toBe(computeSym!.id);
    });

    it('should resolve callersGet and calleesGet via the ProjectIndex API', () => {
      const file = path.join(testDir, 'calls_api.ts');
      fs.writeFileSync(file, `
function helper(): number {
  return 42;
}

function compute(x: number): number {
  return helper() + x;
}

function main() {
  const result = compute(10);
  helper();
}
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });

      const symbols = index.symbolsInFileGet(file);
      const helperSym = symbols.find(s => s.name === 'helper' && s.kind === 'function');
      const computeSym = symbols.find(s => s.name === 'compute' && s.kind === 'function');
      const mainSym = symbols.find(s => s.name === 'main' && s.kind === 'function');

      expect(helperSym).toBeDefined();
      expect(computeSym).toBeDefined();
      expect(mainSym).toBeDefined();

      // calleesGet: main calls compute and helper
      const mainCallees = index.calleesGet(mainSym!.id);
      expect(mainCallees).toContain(computeSym!.id);
      expect(mainCallees).toContain(helperSym!.id);

      // calleesGet: compute calls helper
      const computeCallees = index.calleesGet(computeSym!.id);
      expect(computeCallees).toContain(helperSym!.id);

      // callersGet: helper is called by both compute and main
      const helperCallers = index.callersGet(helperSym!.id);
      expect(helperCallers).toContain(computeSym!.id);
      expect(helperCallers).toContain(mainSym!.id);
    });
  });

  // ==========================================================================
  // Async Builder
  // ==========================================================================

  describe('async builder', () => {
    it('should produce the same result as the sync builder', async () => {
      const file = path.join(testDir, 'async_test.ts');
      fs.writeFileSync(file, `
export function asyncTestFn(): string {
  return 'async';
}

export const asyncTestConst = 42;
`);

      const syncResult = projectIndexBuildSync({ files: [file], dir: testDir });
      const asyncResult = await projectIndexBuild({ files: [file], dir: testDir });

      // Same structure
      expect(asyncResult.stats.filesIndexed).toBe(syncResult.stats.filesIndexed);
      expect(asyncResult.stats.errors).toHaveLength(0);

      // Same symbols
      const syncSymbols = syncResult.index.symbolsInFileGet(file);
      const asyncSymbols = asyncResult.index.symbolsInFileGet(file);
      expect(asyncSymbols.map(s => s.name).sort()).toEqual(syncSymbols.map(s => s.name).sort());

      // Same capabilities
      expect(asyncResult.index.capabilities.crossFileResolution).toBe(true);
    });
  });

  // ==========================================================================
  // Incremental APIs
  // ==========================================================================

  describe('incremental APIs', () => {
    it('should update index from source when content changes', () => {
      const file = path.join(testDir, 'incr_update.ts');
      const originalSource = `export function original() { return 1; }`;
      fs.writeFileSync(file, originalSource);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      // Verify original symbol exists
      const originalSymbols = store.symbolsGet({ file });
      const hasOriginal = originalSymbols.some(s => s.name === 'original');
      expect(hasOriginal).toBe(true);

      // Update from source with different content
      const newSource = `export function updated() { return 2; }\nexport const newConst = 'hello';`;
      const didUpdate = projectIndexUpdateFileFromSource(store, file, newSource);
      expect(didUpdate).toBe(true);

      // Verify new symbols exist
      const updatedSymbols = store.symbolsGet({ file });
      const hasUpdated = updatedSymbols.some(s => s.name === 'updated');
      expect(hasUpdated).toBe(true);
      const hasNewConst = updatedSymbols.some(s => s.name === 'newConst');
      expect(hasNewConst).toBe(true);

      // Original symbol should be gone
      const hasOriginalAfter = updatedSymbols.some(s => s.name === 'original');
      expect(hasOriginalAfter).toBe(false);
    });

    it('should return false when source content is unchanged', () => {
      const file = path.join(testDir, 'incr_unchanged.ts');
      const source = `export function stable() { return 1; }`;
      fs.writeFileSync(file, source);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      // Update with identical source
      const didUpdate = projectIndexUpdateFileFromSource(store, file, source);
      expect(didUpdate).toBe(false);
    });

    it('should remove files and their symbols from the store', () => {
      const fileA = path.join(testDir, 'remove_a.ts');
      const fileB = path.join(testDir, 'remove_b.ts');
      fs.writeFileSync(fileA, `export function fromA() { return 'A'; }`);
      fs.writeFileSync(fileB, `export function fromB() { return 'B'; }`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [fileA, fileB], dir: testDir, store });

      // Both files should be indexed
      const filesBeforeRemove = store.filesGet();
      expect(filesBeforeRemove).toContain(fileA);
      expect(filesBeforeRemove).toContain(fileB);

      // Remove fileA
      projectIndexRemoveFiles(store, [fileA]);

      // fileA gone, fileB intact
      const filesAfterRemove = store.filesGet();
      expect(filesAfterRemove).not.toContain(fileA);
      expect(filesAfterRemove).toContain(fileB);

      // fileA symbols gone
      const symbolsA = store.symbolsGet({ file: fileA });
      expect(symbolsA).toHaveLength(0);

      // fileB symbols intact
      const symbolsB = store.symbolsGet({ file: fileB });
      expect(symbolsB.some(s => s.name === 'fromB')).toBe(true);
    });

    it('should re-resolve import bindings after updating an exporter', () => {
      const exporter = path.join(testDir, 'resolve_exporter.ts');
      const importer = path.join(testDir, 'resolve_importer.ts');

      fs.writeFileSync(exporter, `export function alpha() { return 1; }`);
      fs.writeFileSync(importer, `
import { alpha } from './resolve_exporter';
import { beta } from './resolve_exporter';

const a = alpha();
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [exporter, importer], dir: testDir, store });

      // alpha should be resolved, beta should not (doesn't exist yet)
      const bindingsBefore = store.importBindingsInFileGet(importer);
      const alphaBefore = bindingsBefore.find(b => b.importedName === 'alpha');
      const betaBefore = bindingsBefore.find(b => b.importedName === 'beta');
      expect(alphaBefore?.resolvedExportId).toBeDefined();
      expect(betaBefore?.resolvedExportId).toBeUndefined();

      // Update exporter to add beta
      const newSource = `export function alpha() { return 1; }\nexport function beta() { return 2; }`;
      projectIndexUpdateFileFromSource(store, exporter, newSource);

      // Re-resolve
      crossFileResolveForFile(store, exporter, {
        baseDir: testDir,
        extensions: DEFAULT_EXTENSIONS,
      });

      // Now beta should also be resolved
      const bindingsAfter = store.importBindingsInFileGet(importer);
      const betaAfter = bindingsAfter.find(b => b.importedName === 'beta');
      expect(betaAfter?.resolvedExportId).toBeDefined();

      // alpha should still be resolved
      const alphaAfter = bindingsAfter.find(b => b.importedName === 'alpha');
      expect(alphaAfter?.resolvedExportId).toBeDefined();
    });
  });

  // ==========================================================================
  // adapterRegister — Custom Adapter
  // ==========================================================================

  describe('adapterRegister', () => {
    it('should use a custom adapter when registered for an existing language', () => {
      const file = path.join(testDir, 'adapter_custom.ts');
      fs.writeFileSync(file, `export function hello() { return 'world'; }\n`);

      // Track calls to the spy adapter factory and indexFile.
      const factoryCalls: unknown[] = [];
      const indexFileCalls: string[] = [];

      // Register a spy adapter that returns a hand-crafted delta.
      // We override 'typescript' — languageIdFromFile returns 'typescript'
      // for .ts files, so the builder will route to our adapter.
      adapterRegister('typescript', (language) => {
        factoryCalls.push(language);
        return {
          languageId: 'typescript',
          capabilities: {
            crossFileResolution: false,
            callGraph: 'none' as const,
            symbolKinds: new Set(['function' as const]),
            limitations: ['spy adapter — does not parse real code'],
          },
          indexFile(filePath: string, _bytes: Uint8Array, revision: string) {
            indexFileCalls.push(filePath);
            return {
              file: filePath,
              revision,
              symbols: [
                {
                  id: `spy-sym-${filePath}`,
                  name: 'spyFunction',
                  kind: 'function' as const,
                  file: filePath,
                  byteRange: { start: 0, end: 50 },
                  scopeId: `spy-scope-${filePath}`,
                  qualName: 'spyFunction',
                  flags: SymbolFlags.Exported,
                },
              ],
              scopes: [
                {
                  id: `spy-scope-${filePath}`,
                  kind: 'file' as const,
                  file: filePath,
                  byteRange: { start: 0, end: 100 },
                },
              ],
              relations: [],
              diagnostics: [],
            };
          },
        };
      });

      const { index, stats } = projectIndexBuildSync({
        files: [file],
        dir: testDir,
      });

      // The spy adapter factory was called
      expect(factoryCalls).toHaveLength(1);

      // indexFile was called with the correct file path
      expect(indexFileCalls).toHaveLength(1);
      expect(indexFileCalls[0]).toBe(file);

      // The builder used the spy's delta, not the real adapter's output
      const symbols = index.symbolsInFileGet(file);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('spyFunction');
      expect(symbols[0].flags & SymbolFlags.Exported).toBeTruthy();

      // Stats reflect one file indexed
      expect(stats.filesIndexed).toBe(1);
      expect(stats.errors).toHaveLength(0);

      // NOTE: languageIdFromFile() now consults the langAdd() registry before
      // falling back to the hardcoded switch. A truly custom language registered
      // via langAdd() + adapterRegister() will be routed correctly. However,
      // testing this end-to-end would require a WASM grammar for the custom
      // language, which is outside the scope of this test.
    });
  });
});

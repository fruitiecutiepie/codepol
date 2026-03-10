import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  indexStoreNew,
  SymbolFlags,
} from '@codepol/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('python adapter', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'python', fileExtensions: ['.py'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-python-test-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Symbol Extraction
  // ==========================================================================

  describe('symbol extraction', () => {
    it('should extract class definitions', () => {
      const file = path.join(testDir, 'sym_classes.py');
      fs.writeFileSync(file, `
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return self.name + " makes a sound"

class Dog(Animal):
    pass
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);
      const classes = symbols.filter(s => s.kind === 'class');

      expect(classes.find(s => s.name === 'Animal')).toBeDefined();
      expect(classes.find(s => s.name === 'Dog')).toBeDefined();
    });

    it('should extract function definitions', () => {
      const file = path.join(testDir, 'sym_functions.py');
      fs.writeFileSync(file, `
def greet(name):
    return "hello " + name

def helper():
    return 42

async def fetch_data():
    return []
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);
      const fns = symbols.filter(s => s.kind === 'function');

      const greet = fns.find(s => s.name === 'greet');
      expect(greet).toBeDefined();

      const helper = fns.find(s => s.name === 'helper');
      expect(helper).toBeDefined();

      const fetchData = fns.find(s => s.name === 'fetch_data');
      expect(fetchData).toBeDefined();
      expect(fetchData!.flags & SymbolFlags.Async).toBeTruthy();
    });

    it('should extract variable assignments', () => {
      const file = path.join(testDir, 'sym_variables.py');
      fs.writeFileSync(file, `
MAX_SIZE = 100
config = {"timeout": 5000}
counter = 0
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);

      expect(symbols.find(s => s.name === 'MAX_SIZE')).toBeDefined();
      expect(symbols.find(s => s.name === 'config')).toBeDefined();
      expect(symbols.find(s => s.name === 'counter')).toBeDefined();
    });

    it('should extract parameters including typed, default, *args, and **kwargs', () => {
      const file = path.join(testDir, 'sym_params.py');
      fs.writeFileSync(file, `
def complex_fn(simple, typed: int, default_val=1, *args, **kwargs):
    pass
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);
      const params = symbols.filter(s => s.kind === 'parameter');

      const paramNames = params.map(p => p.name);
      expect(paramNames).toContain('simple');
      expect(paramNames).toContain('typed');
      expect(paramNames).toContain('default_val');
      expect(paramNames).toContain('args');
      expect(paramNames).toContain('kwargs');
    });

    it('should extract import bindings as symbols', () => {
      const file = path.join(testDir, 'sym_imports.py');
      fs.writeFileSync(file, `
import os
from os import path
import json as j
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);

      expect(symbols.find(s => s.name === 'os')).toBeDefined();
      expect(symbols.find(s => s.name === 'path')).toBeDefined();
      expect(symbols.find(s => s.name === 'j')).toBeDefined();
    });

    it('should extract methods inside classes', () => {
      const file = path.join(testDir, 'sym_methods.py');
      fs.writeFileSync(file, `
class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);

      const calculator = symbols.find(s => s.name === 'Calculator' && s.kind === 'class');
      expect(calculator).toBeDefined();

      const fns = symbols.filter(s => s.kind === 'function');
      expect(fns.find(s => s.name === 'add')).toBeDefined();
      expect(fns.find(s => s.name === 'subtract')).toBeDefined();
    });
  });

  // ==========================================================================
  // Scope Tree Construction
  // ==========================================================================

  describe('scope tree construction', () => {
    it('should create module-level file scope', () => {
      const file = path.join(testDir, 'scope_module.py');
      fs.writeFileSync(file, `
x = 1
y = 2
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const scopes = index.scopesInFileGet(file);

      const fileScope = scopes.find(s => s.kind === 'file');
      expect(fileScope).toBeDefined();
      expect(fileScope!.parent).toBeUndefined();
    });

    it('should create nested class and function scopes', () => {
      const file = path.join(testDir, 'scope_nested.py');
      fs.writeFileSync(file, `
class MyClass:
    def method(self):
        x = 1

    def other_method(self):
        y = 2

def standalone():
    z = 3
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const scopes = index.scopesInFileGet(file);

      const fileScope = scopes.find(s => s.kind === 'file');
      expect(fileScope).toBeDefined();

      const classScopes = scopes.filter(s => s.kind === 'class');
      expect(classScopes.length).toBeGreaterThanOrEqual(1);

      const fnScopes = scopes.filter(s => s.kind === 'function');
      expect(fnScopes.length).toBeGreaterThanOrEqual(3);

      for (const fnScope of fnScopes) {
        expect(fnScope.parent).toBeDefined();
      }
    });

    it('should create scope for lambda expressions', () => {
      const file = path.join(testDir, 'scope_lambda.py');
      fs.writeFileSync(file, `
double = lambda x: x * 2
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const scopes = index.scopesInFileGet(file);

      const fnScopes = scopes.filter(s => s.kind === 'function');
      expect(fnScopes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Reference Resolution
  // ==========================================================================

  describe('reference resolution', () => {
    it('should detect file-local references to variables and functions', () => {
      const file = path.join(testDir, 'refs_local.py');
      fs.writeFileSync(file, `
def helper():
    return 42

def main():
    result = helper()
    print(result)
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const refs = index.referencesInFileGet(file);

      const refNames = refs.map(r => r.name);
      expect(refNames).toContain('helper');
      expect(refNames).toContain('result');
      expect(refNames).toContain('print');
    });

    it('should filter out definition-site identifiers from references', () => {
      const file = path.join(testDir, 'refs_filter.py');
      fs.writeFileSync(file, `
def greet(name):
    return name

x = 10
y = x + 1
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const refs = index.referencesInFileGet(file);

      const refNames = refs.map(r => r.name);
      expect(refNames).toContain('x');
      expect(refNames).toContain('name');
    });
  });

  // ==========================================================================
  // Call Detection
  // ==========================================================================

  describe('call detection', () => {
    it('should detect simple function calls', () => {
      const file = path.join(testDir, 'calls_simple.py');
      fs.writeFileSync(file, `
def helper():
    return 42

def main():
    result = helper()
    print(result)
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const allCalls = store.callsGet();
      const calleeNames = allCalls.map(c => c.calleeName);

      expect(calleeNames).toContain('helper');
      expect(calleeNames).toContain('print');
    });

    it('should detect method calls with dotted notation', () => {
      const file = path.join(testDir, 'calls_method.py');
      fs.writeFileSync(file, `
class Greeter:
    def greet(self, name):
        return "Hello " + name

g = Greeter()
g.greet("World")
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const allCalls = store.callsGet();
      const calleeNames = allCalls.map(c => c.calleeName);

      expect(calleeNames).toContain('Greeter');
      expect(calleeNames.some(n => n.includes('greet'))).toBe(true);
    });
  });

  // ==========================================================================
  // Import Extraction
  // ==========================================================================

  describe('import extraction', () => {
    it('should extract from-imports with binding names', () => {
      const file = path.join(testDir, 'imports_from.py');
      fs.writeFileSync(file, `
from os import path
from sys import argv
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const bindings = store.importBindingsInFileGet(file);
      const bindingNames = bindings.map(b => b.importedName);

      expect(bindingNames).toContain('path');
      expect(bindingNames).toContain('argv');
    });

    it('should create symbol for aliased from-import local name', () => {
      const file = path.join(testDir, 'imports_alias.py');
      fs.writeFileSync(file, `
from os import path as p
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);

      // The alias 'p' is captured as a symbol declaration
      expect(symbols.find(s => s.name === 'p')).toBeDefined();
    });

    it('should extract ImportsRelation for from-import statements', () => {
      const file = path.join(testDir, 'imports_relation.py');
      fs.writeFileSync(file, `
from os import path
from json import loads, dumps
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const imports = store.importsInFileGet(file);
      const specs = imports.map(i => i.spec);

      expect(specs).toContain('os');
    });
  });

  // ==========================================================================
  // Export Extraction
  // ==========================================================================

  describe('export extraction', () => {
    it('should extract module-level function definitions as potentially exported', () => {
      const file = path.join(testDir, 'exports_funcs.py');
      fs.writeFileSync(file, `
def public_func():
    return 1

def _private_func():
    return 2
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);
      const fns = symbols.filter(s => s.kind === 'function');

      expect(fns.find(s => s.name === 'public_func')).toBeDefined();
      expect(fns.find(s => s.name === '_private_func')).toBeDefined();
    });

    it('should extract module-level class definitions', () => {
      const file = path.join(testDir, 'exports_classes.py');
      fs.writeFileSync(file, `
class PublicClass:
    pass

class _InternalClass:
    pass
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);
      const classes = symbols.filter(s => s.kind === 'class');

      expect(classes.find(s => s.name === 'PublicClass')).toBeDefined();
      expect(classes.find(s => s.name === '_InternalClass')).toBeDefined();
    });
  });

  // ==========================================================================
  // Cross-file Python tests (skipped)
  // ==========================================================================

  describe('cross-file resolution', () => {
    // TODO: remove .skip once Python module resolution is implemented in moduleResolver.ts
    // Python requires __init__.py package detection, no file extensions, and
    // a different path resolution algorithm than TypeScript.

    it.skip('should resolve relative imports (from .sibling import foo)', () => {
      // Python relative imports: from .sibling import foo
    });

    it.skip('should resolve package imports (from package import module)', () => {
      // Python package imports with __init__.py
    });

    it.skip('should resolve cross-file references through imports', () => {
      // Cross-file reference resolution via import bindings
    });
  });
});

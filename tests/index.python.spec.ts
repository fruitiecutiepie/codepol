import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  indexStoreNew,
  SymbolFlags,
  type FlowGraph,
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

    it('should create ImportBindingRelation for bare import foo', () => {
      const file = path.join(testDir, 'imports_bare.py');
      fs.writeFileSync(file, `
import os
import json
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const bindings = store.importBindingsInFileGet(file);
      const osBinding = bindings.find(b => b.moduleSpec === 'os');
      expect(osBinding).toBeDefined();
      expect(osBinding!.isNamespace).toBe(true);
      expect(osBinding!.importedName).toBe('*');

      const jsonBinding = bindings.find(b => b.moduleSpec === 'json');
      expect(jsonBinding).toBeDefined();
      expect(jsonBinding!.isNamespace).toBe(true);
    });

    it('should create ImportBindingRelation for aliased import foo as f', () => {
      const file = path.join(testDir, 'imports_bare_alias.py');
      fs.writeFileSync(file, `
import json as j
import os as operating_system
`);

      const store = indexStoreNew();
      const { index } = projectIndexBuildSync({ files: [file], dir: testDir, store });

      const bindings = store.importBindingsInFileGet(file);
      const jsonBinding = bindings.find(b => b.moduleSpec === 'json');
      expect(jsonBinding).toBeDefined();
      expect(jsonBinding!.isNamespace).toBe(true);

      const symbols = index.symbolsInFileGet(file);
      const jSym = symbols.find(s => s.name === 'j');
      expect(jSym).toBeDefined();
      expect(jsonBinding!.localSymbolId).toBe(jSym!.id);
    });

    it('should create ImportBindingRelation with correct alias for from-import', () => {
      const file = path.join(testDir, 'imports_from_alias.py');
      fs.writeFileSync(file, `
from os import path as p
from collections import OrderedDict as OD
`);

      const store = indexStoreNew();
      const { index } = projectIndexBuildSync({ files: [file], dir: testDir, store });

      const bindings = store.importBindingsInFileGet(file);

      const pathBinding = bindings.find(b => b.importedName === 'path' && b.moduleSpec === 'os');
      expect(pathBinding).toBeDefined();

      const symbols = index.symbolsInFileGet(file);
      const pSym = symbols.find(s => s.name === 'p');
      expect(pSym).toBeDefined();
      expect(pathBinding!.localSymbolId).toBe(pSym!.id);

      const odBinding = bindings.find(b => b.importedName === 'OrderedDict');
      expect(odBinding).toBeDefined();
      const odSym = symbols.find(s => s.name === 'OD');
      expect(odSym).toBeDefined();
      expect(odBinding!.localSymbolId).toBe(odSym!.id);
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

    it('should create ExportsRelation for module-level functions', () => {
      const file = path.join(testDir, 'exports_rel_funcs.py');
      fs.writeFileSync(file, `
def alpha():
    return 1

def beta():
    return 2
`);

      const store = indexStoreNew();
      const { index } = projectIndexBuildSync({ files: [file], dir: testDir, store });

      const exports = store.exportsInFileGet(file);
      const exportedNames = exports.map(e => e.exportedName);

      expect(exportedNames).toContain('alpha');
      expect(exportedNames).toContain('beta');
      expect(exports.every(e => !e.isDefault)).toBe(true);
    });

    it('should create ExportsRelation for module-level classes', () => {
      const file = path.join(testDir, 'exports_rel_classes.py');
      fs.writeFileSync(file, `
class MyService:
    pass

class MyModel:
    pass
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const exports = store.exportsInFileGet(file);
      const exportedNames = exports.map(e => e.exportedName);

      expect(exportedNames).toContain('MyService');
      expect(exportedNames).toContain('MyModel');
    });

    it('should create ExportsRelation for module-level variables', () => {
      const file = path.join(testDir, 'exports_rel_vars.py');
      fs.writeFileSync(file, `
VERSION = "1.0.0"
MAX_RETRIES = 3
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const exports = store.exportsInFileGet(file);
      const exportedNames = exports.map(e => e.exportedName);

      expect(exportedNames).toContain('VERSION');
      expect(exportedNames).toContain('MAX_RETRIES');
    });

    it('should set Exported flag on exported symbols', () => {
      const file = path.join(testDir, 'exports_flags.py');
      fs.writeFileSync(file, `
def exported_func():
    pass

class ExportedClass:
    pass
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const symbols = index.symbolsInFileGet(file);

      const func = symbols.find(s => s.name === 'exported_func');
      expect(func).toBeDefined();
      expect(func!.flags & SymbolFlags.Exported).toBeTruthy();

      const cls = symbols.find(s => s.name === 'ExportedClass');
      expect(cls).toBeDefined();
      expect(cls!.flags & SymbolFlags.Exported).toBeTruthy();
    });

    it('should create ExportsRelation from __all__ list', () => {
      const file = path.join(testDir, 'exports_all.py');
      fs.writeFileSync(file, `
def alpha():
    pass

def beta():
    pass

def _internal():
    pass

__all__ = ["alpha", "beta"]
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const exports = store.exportsInFileGet(file);
      const allExportNames = exports.map(e => e.exportedName);

      expect(allExportNames).toContain('alpha');
      expect(allExportNames).toContain('beta');
    });

    it('should create ExportsRelation from __all__ tuple', () => {
      const file = path.join(testDir, 'exports_all_tuple.py');
      fs.writeFileSync(file, `
def foo():
    pass

def bar():
    pass

__all__ = ("foo", "bar")
`);

      const store = indexStoreNew();
      projectIndexBuildSync({ files: [file], dir: testDir, store });

      const exports = store.exportsInFileGet(file);
      const allExportNames = exports.map(e => e.exportedName);

      expect(allExportNames).toContain('foo');
      expect(allExportNames).toContain('bar');
    });
  });

  // ==========================================================================
  // Control Flow Graph Extraction
  // ==========================================================================

  describe('CFG extraction', () => {
    function pyCfgGet(source: string, fileName: string): FlowGraph | undefined {
      const file = path.join(testDir, fileName);
      fs.writeFileSync(file, source);
      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const scopes = index.scopesInFileGet(file);
      const fnScope = scopes.find(s => s.kind === 'function');
      if (!fnScope) return undefined;
      return index.cfgGet(fnScope.id);
    }

    it('should produce a CFG for a simple Python function', () => {
      const cfg = pyCfgGet(`
def hello():
    x = 1
    y = 2
    return x + y
`, 'cfg_simple.py');

      expect(cfg).toBeDefined();
      expect(cfg!.nodes.some(n => n.kind === 'entry')).toBe(true);
      expect(cfg!.nodes.some(n => n.kind === 'exit')).toBe(true);
      expect(cfg!.nodes.some(n => n.kind === 'return')).toBe(true);
    });

    it('should produce CFG with branching for if/else', () => {
      const cfg = pyCfgGet(`
def check(x):
    if x > 0:
        return "positive"
    else:
        return "non-positive"
`, 'cfg_ifelse.py');

      expect(cfg).toBeDefined();
      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes.length).toBeGreaterThanOrEqual(1);

      const returnNodes = cfg!.nodes.filter(n => n.kind === 'return');
      expect(returnNodes.length).toBeGreaterThanOrEqual(2);
    });

    it('should produce CFG with throw node for raise statement', () => {
      const cfg = pyCfgGet(`
def validate(x):
    if x < 0:
        raise ValueError("negative")
    return x
`, 'cfg_raise.py');

      expect(cfg).toBeDefined();
      const throwNodes = cfg!.nodes.filter(n => n.kind === 'throw');
      expect(throwNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce CFG with loop for while statement', () => {
      const cfg = pyCfgGet(`
def count_down(n):
    while n > 0:
        n = n - 1
    return n
`, 'cfg_while.py');

      expect(cfg).toBeDefined();
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes.length).toBeGreaterThanOrEqual(1);

      const backEdges = cfg!.edges.filter(e => e.label === 'loop-back');
      expect(backEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce separate CFGs for multiple functions', () => {
      const file = path.join(testDir, 'cfg_multi.py');
      fs.writeFileSync(file, `
def first():
    return 1

def second():
    return 2

def third():
    return 3
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const scopes = index.scopesInFileGet(file);
      const fnScopes = scopes.filter(s => s.kind === 'function');
      const cfgs = fnScopes
        .map(s => index.cfgGet(s.id))
        .filter((c): c is FlowGraph => c !== undefined);

      expect(cfgs.length).toBe(3);
    });

    it('should produce CFG for methods inside classes', () => {
      const file = path.join(testDir, 'cfg_methods.py');
      fs.writeFileSync(file, `
class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b
`);

      const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
      const scopes = index.scopesInFileGet(file);
      const fnScopes = scopes.filter(s => s.kind === 'function');
      const cfgs = fnScopes
        .map(s => index.cfgGet(s.id))
        .filter((c): c is FlowGraph => c !== undefined);

      expect(cfgs.length).toBe(2);
    });

    it('should produce CFG with loop for Python for-in statement', () => {
      const cfg = pyCfgGet(`
def process(items):
    total = 0
    for item in items:
        total = total + item
    return total
`, 'cfg_for.py');

      expect(cfg).toBeDefined();
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes.length).toBeGreaterThanOrEqual(1);

      const backEdges = cfg!.edges.filter(e => e.label === 'loop-back');
      expect(backEdges.length).toBeGreaterThanOrEqual(1);

      const falseEdges = cfg!.edges.filter(e => e.label === 'false');
      expect(falseEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle try/except in CFG', () => {
      const cfg = pyCfgGet(`
def safe_divide(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        return 0
`, 'cfg_tryexcept.py');

      expect(cfg).toBeDefined();
      expect(cfg!.nodes.length).toBeGreaterThan(2);
    });
  });

  // ==========================================================================
  // Cross-file Python tests (skipped)
  // ==========================================================================

  describe('cross-file resolution', () => {
    it('should resolve relative imports (from .sibling import foo)', () => {
      const pkgDir = path.join(testDir, 'relpkg');
      fs.mkdirSync(pkgDir, { recursive: true });

      const initFile = path.join(pkgDir, '__init__.py');
      fs.writeFileSync(initFile, '');

      const siblingFile = path.join(pkgDir, 'sibling.py');
      fs.writeFileSync(siblingFile, `
def helper():
    return 42
`);

      const mainFile = path.join(pkgDir, 'main.py');
      fs.writeFileSync(mainFile, `
from .sibling import helper

result = helper()
`);

      const { index } = projectIndexBuildSync({
        files: [initFile, siblingFile, mainFile],
        dir: testDir,
      });

      const importBindings = index.importBindingsGet(mainFile);
      const helperBinding = importBindings.find(b => b.importedName === 'helper');
      expect(helperBinding).toBeDefined();
      expect(helperBinding!.resolvedModulePath).toBe(siblingFile);
      expect(helperBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve package imports (from mypkg.utils import compute)', () => {
      const pkgDir = path.join(testDir, 'mypkg');
      fs.mkdirSync(pkgDir, { recursive: true });

      const initFile = path.join(pkgDir, '__init__.py');
      fs.writeFileSync(initFile, '');

      const subFile = path.join(pkgDir, 'utils.py');
      fs.writeFileSync(subFile, `
def compute():
    return 99
`);

      const consumerFile = path.join(testDir, 'consumer.py');
      fs.writeFileSync(consumerFile, `
from mypkg.utils import compute
`);

      const store = indexStoreNew();
      projectIndexBuildSync({
        files: [initFile, subFile, consumerFile],
        dir: testDir,
        store,
      });

      const bindings = store.importBindingsInFileGet(consumerFile);
      const computeBinding = bindings.find(b => b.importedName === 'compute' && b.moduleSpec === 'mypkg.utils');
      expect(computeBinding).toBeDefined();
      expect(computeBinding!.resolvedModulePath).toBe(subFile);
      expect(computeBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve cross-file references through imports', () => {
      const pkgDir = path.join(testDir, 'refpkg');
      fs.mkdirSync(pkgDir, { recursive: true });

      const initFile = path.join(pkgDir, '__init__.py');
      fs.writeFileSync(initFile, '');

      const libFile = path.join(pkgDir, 'lib.py');
      fs.writeFileSync(libFile, `
def greet(name):
    return "hello " + name
`);

      const appFile = path.join(pkgDir, 'app.py');
      fs.writeFileSync(appFile, `
from .lib import greet

msg = greet("world")
`);

      const { index } = projectIndexBuildSync({
        files: [initFile, libFile, appFile],
        dir: testDir,
      });

      const exportedSymbols = index.exportedSymbolsGet({ file: libFile });
      const greetSymbol = exportedSymbols.find(s => s.name === 'greet');
      expect(greetSymbol).toBeDefined();

      const importBindings = index.importBindingsGet(appFile);
      const greetBinding = importBindings.find(b => b.importedName === 'greet');
      expect(greetBinding).toBeDefined();
      expect(greetBinding!.resolvedExportId).toBe(greetSymbol!.id);
    });
  });
});

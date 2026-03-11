import { describe, expect, it, beforeAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  indexStoreNew,
  SymbolFlags,
  type ProjectIndex,
  type IndexStore,
  type FlowGraph,
} from '@codepol/core';
import fg from 'fast-glob';
import path from 'node:path';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/py');

describe('python adapter – fixture project', () => {
  let store: IndexStore;
  let index: ProjectIndex;
  let files: string[];
  let stats: { filesIndexed: number; filesSkipped: number; errors: string[] };

  function fixtureFile(...segments: string[]): string {
    return path.join(FIXTURE_DIR, ...segments);
  }

  beforeAll(async () => {
    langAdd({ langId: 'python', fileExtensions: ['.py'] });
    await parserInit();
    files = fg.sync('**/*.py', { cwd: FIXTURE_DIR, absolute: true });
    store = indexStoreNew();
    const result = projectIndexBuildSync({ files, dir: FIXTURE_DIR, store });
    index = result.index;
    stats = result.stats;
  });

  // ==========================================================================
  // 1. Whole-project indexing
  // ==========================================================================

  describe('whole-project indexing', () => {
    it('should index all .py files without errors', () => {
      expect(stats.errors).toHaveLength(0);
    });

    it('should index the expected number of files', () => {
      expect(stats.filesIndexed).toBe(files.length);
    });

    it('should have indexed at least 12 files', () => {
      expect(files.length).toBeGreaterThanOrEqual(12);
    });
  });

  // ==========================================================================
  // 2. Realistic cross-file resolution
  // ==========================================================================

  describe('cross-file resolution', () => {
    it('should resolve standalone.py dotted import to models/user.py', () => {
      const standalone = fixtureFile('standalone.py');
      const userFile = fixtureFile('myapp', 'models', 'user.py');

      const bindings = index.importBindingsGet(standalone);
      const userBinding = bindings.find(
        b => b.importedName === 'User' && b.moduleSpec === 'myapp.models.user'
      );
      expect(userBinding).toBeDefined();
      expect(userBinding!.resolvedModulePath).toBe(userFile);
      expect(userBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve services/auth.py relative import to models/base.py', () => {
      const authFile = fixtureFile('myapp', 'services', 'auth.py');
      const baseFile = fixtureFile('myapp', 'models', 'base.py');

      const bindings = index.importBindingsGet(authFile);
      const baseBinding = bindings.find(b => b.importedName === 'BaseModel');
      expect(baseBinding).toBeDefined();
      expect(baseBinding!.resolvedModulePath).toBe(baseFile);
      expect(baseBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve cli/commands.py relative import to config.py', () => {
      const commandsFile = fixtureFile('myapp', 'cli', 'commands.py');
      const configFile = fixtureFile('myapp', 'config.py');

      const bindings = index.importBindingsGet(commandsFile);
      const debugBinding = bindings.find(b => b.importedName === 'DEBUG');
      expect(debugBinding).toBeDefined();
      expect(debugBinding!.resolvedModulePath).toBe(configFile);
      expect(debugBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve plugins/loader.py dotted import to services/auth.py', () => {
      const loaderFile = fixtureFile('plugins', 'loader.py');
      const authFile = fixtureFile('myapp', 'services', 'auth.py');

      const bindings = index.importBindingsGet(loaderFile);
      const authBinding = bindings.find(b => b.importedName === 'authenticate');
      expect(authBinding).toBeDefined();
      expect(authBinding!.resolvedModulePath).toBe(authFile);
      expect(authBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve submodule import "from myapp import models" to __init__.py', () => {
      const standalone = fixtureFile('standalone.py');
      const modelsInit = fixtureFile('myapp', 'models', '__init__.py');

      const bindings = index.importBindingsGet(standalone);
      const modelsBinding = bindings.find(
        b => b.importedName === 'models' && b.moduleSpec === 'myapp'
      );
      expect(modelsBinding).toBeDefined();
      expect(modelsBinding!.resolvedModulePath).toBe(modelsInit);
      expect(modelsBinding!.isNamespace).toBe(true);
    });

    it('should resolve cli/commands.py relative import to models/user.py', () => {
      const commandsFile = fixtureFile('myapp', 'cli', 'commands.py');
      const userFile = fixtureFile('myapp', 'models', 'user.py');

      const bindings = index.importBindingsGet(commandsFile);
      const userBinding = bindings.find(b => b.importedName === 'User');
      expect(userBinding).toBeDefined();
      expect(userBinding!.resolvedModulePath).toBe(userFile);
    });
  });

  // ==========================================================================
  // 3. __init__.py re-exports and __all__
  // ==========================================================================

  describe('__init__.py re-exports and __all__', () => {
    it('should extract __all__ exports from models/__init__.py', () => {
      const modelsInit = fixtureFile('myapp', 'models', '__init__.py');

      const exports = store.exportsInFileGet(modelsInit);
      const exportedNames = exports.map(e => e.exportedName);

      expect(exportedNames).toContain('BaseModel');
      expect(exportedNames).toContain('User');
    });

    it('should extract __all__ exports from myapp/__init__.py', () => {
      const myappInit = fixtureFile('myapp', '__init__.py');

      const exports = store.exportsInFileGet(myappInit);
      const exportedNames = exports.map(e => e.exportedName);

      expect(exportedNames).toContain('VERSION');
      expect(exportedNames).toContain('User');
    });

    it('should set Exported flag on symbols listed in __all__', () => {
      const modelsInit = fixtureFile('myapp', 'models', '__init__.py');
      const symbols = index.symbolsInFileGet(modelsInit);

      const baseModelSym = symbols.find(s => s.name === 'BaseModel');
      expect(baseModelSym).toBeDefined();
      expect(baseModelSym!.flags & SymbolFlags.Exported).toBeTruthy();
    });
  });

  // ==========================================================================
  // 4. Decorators
  // ==========================================================================

  describe('decorators', () => {
    it('should extract decorated methods as function symbols', () => {
      const baseFile = fixtureFile('myapp', 'models', 'base.py');
      const symbols = index.symbolsInFileGet(baseFile);
      const fns = symbols.filter(s => s.kind === 'function');
      const fnNames = fns.map(f => f.name);

      expect(fnNames).toContain('id');
      expect(fnNames).toContain('create_table');
      expect(fnNames).toContain('save');
    });

    it('should capture decorator names as references', () => {
      const baseFile = fixtureFile('myapp', 'models', 'base.py');
      const refs = index.referencesInFileGet(baseFile);
      const refNames = refs.map(r => r.name);

      expect(refNames).toContain('property');
      expect(refNames).toContain('staticmethod');
    });
  });

  // ==========================================================================
  // 5. Star imports
  // ==========================================================================

  describe('star imports', () => {
    it('should track star import module in plugins/loader.py', () => {
      const loaderFile = fixtureFile('plugins', 'loader.py');
      const helpersFile = fixtureFile('myapp', 'services', 'helpers.py');

      const imports = index.importsGet(loaderFile);
      const starImport = imports.find(
        i => i.spec === 'myapp.services.helpers'
      );
      expect(starImport).toBeDefined();
      expect(starImport!.resolvedModulePath).toBe(helpersFile);
    });
  });

  // ==========================================================================
  // 6. Comprehensions as scopes
  // ==========================================================================

  describe('comprehensions as scopes', () => {
    it('should create scope nodes for list/dict/set comprehensions', () => {
      const helpersFile = fixtureFile('myapp', 'services', 'helpers.py');
      const scopes = index.scopesInFileGet(helpersFile);
      const scopeKinds = scopes.map(s => s.kind);

      expect(scopeKinds.filter(k => k === 'file')).toHaveLength(1);
      // list comp in squares, dict comp in name_lengths, set comp in unique_initials,
      // generator expr in lazy_values — all create scopes
      const nonFileFnScopes = scopes.filter(
        s => s.kind !== 'file' && s.kind !== 'function'
      );
      expect(nonFileFnScopes.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ==========================================================================
  // 7. Nested classes and multiple inheritance
  // ==========================================================================

  describe('nested classes and multiple inheritance', () => {
    it('should extract nested Meta class inside User', () => {
      const userFile = fixtureFile('myapp', 'models', 'user.py');
      const symbols = index.symbolsInFileGet(userFile);
      const classes = symbols.filter(s => s.kind === 'class');
      const classNames = classes.map(c => c.name);

      expect(classNames).toContain('User');
      expect(classNames).toContain('Meta');
      expect(classNames).toContain('Serializable');
    });

    it('should have class scope for the nested Meta class', () => {
      const userFile = fixtureFile('myapp', 'models', 'user.py');
      const scopes = index.scopesInFileGet(userFile);
      const classScopes = scopes.filter(s => s.kind === 'class');

      // User, Serializable, Meta = 3 class scopes
      expect(classScopes.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ==========================================================================
  // 8. Async, with, except, lambda, *args/**kwargs
  // ==========================================================================

  describe('async, with, except, lambda, args/kwargs', () => {
    it('should mark async functions with the Async flag', () => {
      const authFile = fixtureFile('myapp', 'services', 'auth.py');
      const symbols = index.symbolsInFileGet(authFile);

      const authenticate = symbols.find(s => s.name === 'authenticate');
      expect(authenticate).toBeDefined();
      expect(authenticate!.flags & SymbolFlags.Async).toBeTruthy();

      const refreshToken = symbols.find(s => s.name === 'refresh_token');
      expect(refreshToken).toBeDefined();
      expect(refreshToken!.flags & SymbolFlags.Async).toBeTruthy();
    });

    it('should extract with-statement binding as a variable', () => {
      const authFile = fixtureFile('myapp', 'services', 'auth.py');
      const symbols = index.symbolsInFileGet(authFile);

      const logFile = symbols.find(s => s.name === 'log_file');
      expect(logFile).toBeDefined();
    });

    it('should extract except-clause binding as a variable', () => {
      const authFile = fixtureFile('myapp', 'services', 'auth.py');
      const symbols = index.symbolsInFileGet(authFile);

      const err = symbols.find(s => s.name === 'err');
      expect(err).toBeDefined();
    });

    it('should create function scopes for lambda expressions', () => {
      const helpersFile = fixtureFile('myapp', 'services', 'helpers.py');
      const scopes = index.scopesInFileGet(helpersFile);
      const fnScopes = scopes.filter(s => s.kind === 'function');

      // Named functions: squares, name_lengths, unique_initials, lazy_values, process_batch
      // Lambdas: double, transform = 2 lambda scopes
      expect(fnScopes.length).toBeGreaterThanOrEqual(7);
    });

    it('should extract *args and **kwargs parameters', () => {
      const userFile = fixtureFile('myapp', 'models', 'user.py');
      const symbols = index.symbolsInFileGet(userFile);
      const params = symbols.filter(s => s.kind === 'parameter');
      const paramNames = params.map(p => p.name);

      expect(paramNames).toContain('args');
      expect(paramNames).toContain('kwargs');
    });
  });

  // ==========================================================================
  // 9. Large symbol count (config.py)
  // ==========================================================================

  describe('large symbol count', () => {
    it('should extract all module-level variables from config.py', () => {
      const configFile = fixtureFile('myapp', 'config.py');
      const symbols = index.symbolsInFileGet(configFile);
      const varNames = symbols.filter(s => s.kind === 'variable').map(s => s.name);

      const expected = [
        'VERSION', 'DEBUG', 'MAX_RETRIES', 'TIMEOUT_MS',
        'APP_NAME', 'DEFAULT_PORT', 'LOG_LEVEL', 'ENABLE_CACHE',
        'SECRET_KEY', 'DATABASE_URL',
      ];
      for (const name of expected) {
        expect(varNames).toContain(name);
      }
    });

    it('should export all module-level variables from config.py', () => {
      const configFile = fixtureFile('myapp', 'config.py');
      const exports = store.exportsInFileGet(configFile);
      const exportedNames = exports.map(e => e.exportedName);

      expect(exportedNames).toContain('VERSION');
      expect(exportedNames).toContain('DEBUG');
      expect(exportedNames).toContain('MAX_RETRIES');
      expect(exportedNames).toContain('SECRET_KEY');
      expect(exportedNames.length).toBeGreaterThanOrEqual(10);
    });
  });

  // ==========================================================================
  // 10. CFG extraction across fixture
  // ==========================================================================

  describe('CFG extraction', () => {
    function cfgGetForFunction(
      file: string,
      funcName: string
    ): FlowGraph | undefined {
      const scopes = index.scopesInFileGet(file);
      const symbols = index.symbolsInFileGet(file);
      const fnSymbol = symbols.find(
        s => s.name === funcName && s.kind === 'function'
      );
      if (!fnSymbol) return undefined;
      const fnScope = scopes.find(
        s =>
          s.kind === 'function' &&
          s.byteRange.start === fnSymbol.byteRange.start
      );
      if (!fnScope) return undefined;
      return index.cfgGet(fnScope.id);
    }

    it('should produce CFG with branching for validate_id (if + raise)', () => {
      const baseFile = fixtureFile('myapp', 'models', 'base.py');
      const cfg = cfgGetForFunction(baseFile, 'validate_id');

      expect(cfg).toBeDefined();
      expect(cfg!.nodes.some(n => n.kind === 'branch')).toBe(true);
      expect(cfg!.nodes.some(n => n.kind === 'throw')).toBe(true);
    });

    it('should produce CFG with try/except for authenticate', () => {
      const authFile = fixtureFile('myapp', 'services', 'auth.py');
      const cfg = cfgGetForFunction(authFile, 'authenticate');

      expect(cfg).toBeDefined();
      expect(cfg!.nodes.some(n => n.kind === 'entry')).toBe(true);
      expect(cfg!.nodes.some(n => n.kind === 'exit')).toBe(true);
      expect(cfg!.nodes.length).toBeGreaterThan(2);
    });

    it('should produce CFG with loop for run_command (for-loop)', () => {
      const commandsFile = fixtureFile('myapp', 'cli', 'commands.py');
      const cfg = cfgGetForFunction(commandsFile, 'run_command');

      expect(cfg).toBeDefined();
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes.length).toBeGreaterThanOrEqual(1);

      const backEdges = cfg!.edges.filter(e => e.label === 'loop-back');
      expect(backEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce CFG for process_batch (for-loop)', () => {
      const helpersFile = fixtureFile('myapp', 'services', 'helpers.py');
      const cfg = cfgGetForFunction(helpersFile, 'process_batch');

      expect(cfg).toBeDefined();
      expect(cfg!.nodes.some(n => n.kind === 'loop')).toBe(true);
    });

    it('should produce CFGs for multiple functions in the same file', () => {
      const helpersFile = fixtureFile('myapp', 'services', 'helpers.py');
      const scopes = index.scopesInFileGet(helpersFile);
      const fnScopes = scopes.filter(s => s.kind === 'function');
      const cfgs = fnScopes
        .map(s => index.cfgGet(s.id))
        .filter((c): c is FlowGraph => c !== undefined);

      expect(cfgs.length).toBeGreaterThanOrEqual(5);
    });
  });
});

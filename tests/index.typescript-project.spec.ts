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

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/ts-project');

describe('typescript adapter – fixture project', () => {
  let store: IndexStore;
  let index: ProjectIndex;
  let files: string[];
  let stats: { filesIndexed: number; filesSkipped: number; errors: string[] };

  function fixtureFile(...segments: string[]): string {
    return path.join(FIXTURE_DIR, ...segments);
  }

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    files = fg.sync('**/*.ts', { cwd: FIXTURE_DIR, absolute: true });
    store = indexStoreNew();
    const result = projectIndexBuildSync({ files, dir: FIXTURE_DIR, store });
    index = result.index;
    stats = result.stats;
  });

  // ==========================================================================
  // 1. Whole-project indexing
  // ==========================================================================

  describe('whole-project indexing', () => {
    it('should index all .ts files without errors', () => {
      expect(stats.errors).toHaveLength(0);
    });

    it('should index the expected number of files', () => {
      expect(stats.filesIndexed).toBe(files.length);
    });

    it('should have indexed at least 11 files', () => {
      expect(files.length).toBeGreaterThanOrEqual(11);
    });
  });

  // ==========================================================================
  // 2. Cross-file resolution through barrels
  // ==========================================================================

  describe('cross-file resolution', () => {
    it('should resolve app.ts named imports through models barrel', () => {
      const appFile = fixtureFile('app.ts');
      const modelsIndex = fixtureFile('models', 'index.ts');

      const bindings = index.importBindingsGet(appFile);
      const userBinding = bindings.find(
        b => b.importedName === 'User' && b.moduleSpec === './models'
      );
      expect(userBinding).toBeDefined();
      expect(userBinding!.resolvedModulePath).toBe(modelsIndex);
      expect(userBinding!.resolvedExportId).toBeDefined();

      const createUserBinding = bindings.find(
        b => b.importedName === 'createUser' && b.moduleSpec === './models'
      );
      expect(createUserBinding).toBeDefined();
      expect(createUserBinding!.resolvedModulePath).toBe(modelsIndex);
      expect(createUserBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve app.ts namespace import to services barrel', () => {
      const appFile = fixtureFile('app.ts');
      const servicesIndex = fixtureFile('services', 'index.ts');

      const bindings = index.importBindingsGet(appFile);
      const servicesBinding = bindings.find(
        b => b.isNamespace && b.moduleSpec === './services'
      );
      expect(servicesBinding).toBeDefined();
      expect(servicesBinding!.resolvedModulePath).toBe(servicesIndex);
    });

    it('should resolve app.ts default import from utils/math', () => {
      const appFile = fixtureFile('app.ts');
      const mathFile = fixtureFile('utils', 'math.ts');

      const bindings = index.importBindingsGet(appFile);
      const sumBinding = bindings.find(
        b => b.isDefault && b.moduleSpec === './utils/math'
      );
      expect(sumBinding).toBeDefined();
      expect(sumBinding!.resolvedModulePath).toBe(mathFile);
      expect(sumBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve app.ts named import from utils/collections', () => {
      const appFile = fixtureFile('app.ts');
      const collectionsFile = fixtureFile('utils', 'collections.ts');

      const bindings = index.importBindingsGet(appFile);
      const groupByBinding = bindings.find(
        b => b.importedName === 'groupBy' && b.moduleSpec === './utils/collections'
      );
      expect(groupByBinding).toBeDefined();
      expect(groupByBinding!.resolvedModulePath).toBe(collectionsFile);
      expect(groupByBinding!.resolvedExportId).toBeDefined();
    });

    it('should resolve auth.ts imports to user.ts and config.ts', () => {
      const authFile = fixtureFile('services', 'auth.ts');
      const userFile = fixtureFile('models', 'user.ts');
      const configFile = fixtureFile('config.ts');

      const bindings = index.importBindingsGet(authFile);

      const userBinding = bindings.find(b => b.importedName === 'User');
      expect(userBinding).toBeDefined();
      expect(userBinding!.resolvedModulePath).toBe(userFile);

      const secretBinding = bindings.find(b => b.importedName === 'SECRET_KEY');
      expect(secretBinding).toBeDefined();
      expect(secretBinding!.resolvedModulePath).toBe(configFile);
    });

    it('should resolve type-only import in app.ts', () => {
      const appFile = fixtureFile('app.ts');
      const typesFile = fixtureFile('types.ts');

      const bindings = index.importBindingsGet(appFile);
      const resultBinding = bindings.find(
        b => b.importedName === 'Result' && b.moduleSpec === './types'
      );
      expect(resultBinding).toBeDefined();
      expect(resultBinding!.resolvedModulePath).toBe(typesFile);
      expect(resultBinding!.resolvedExportId).toBeDefined();
    });
  });

  // ==========================================================================
  // 3. Barrel re-exports and namespace re-exports
  // ==========================================================================

  describe('barrel re-exports', () => {
    it('should surface re-exports from models/index.ts', () => {
      const modelsIndex = fixtureFile('models', 'index.ts');
      const exports = index.fileExportsGet(modelsIndex);
      const names = exports.map(e => e.exportedName);

      expect(names).toContain('BaseModel');
      expect(names).toContain('User');
      expect(names).toContain('createUser');
    });

    it('should surface namespace re-export from services/index.ts', () => {
      const servicesIndex = fixtureFile('services', 'index.ts');
      const exports = index.fileExportsGet(servicesIndex);

      const authExport = exports.find(e => e.exportedName === 'auth');
      expect(authExport).toBeDefined();
      expect(authExport!.sourceModule).toBe('./auth');
      expect(authExport!.sourceName).toBe('*');
    });

    it('should surface named re-exports from services/index.ts', () => {
      const servicesIndex = fixtureFile('services', 'index.ts');
      const exports = index.fileExportsGet(servicesIndex);
      const names = exports.map(e => e.exportedName);

      expect(names).toContain('range');
      expect(names).toContain('fibonacci');
      expect(names).toContain('double');
      expect(names).toContain('pipeline');
      expect(names).toContain('safeGet');
    });
  });

  // ==========================================================================
  // 4. Type hierarchy (extends / implements)
  // ==========================================================================

  describe('type hierarchy', () => {
    it('should detect User extends BaseModel', () => {
      const userFile = fixtureFile('models', 'user.ts');
      const typeRels = store.typeRelationsInFileGet(userFile);

      const extendsRel = typeRels.find(
        r => r.targetName === 'BaseModel' && r.relationKind === 'extends'
      );
      expect(extendsRel).toBeDefined();
      expect(extendsRel!.resolvedTargetId).toBeDefined();
    });

    it('should detect User implements Serializable', () => {
      const userFile = fixtureFile('models', 'user.ts');
      const typeRels = store.typeRelationsInFileGet(userFile);

      const implementsRel = typeRels.find(
        r => r.targetName === 'Serializable' && r.relationKind === 'implements'
      );
      expect(implementsRel).toBeDefined();
      expect(implementsRel!.resolvedTargetId).toBeDefined();
    });

    it('should detect BaseModel implements Identifiable and Timestamped', () => {
      const baseFile = fixtureFile('models', 'base.ts');
      const typeRels = store.typeRelationsInFileGet(baseFile);

      const identifiableRel = typeRels.find(r => r.targetName === 'Identifiable');
      expect(identifiableRel).toBeDefined();
      expect(identifiableRel!.relationKind).toBe('implements');
      expect(identifiableRel!.resolvedTargetId).toBeDefined();

      const timestampedRel = typeRels.find(r => r.targetName === 'Timestamped');
      expect(timestampedRel).toBeDefined();
      expect(timestampedRel!.relationKind).toBe('implements');
      expect(timestampedRel!.resolvedTargetId).toBeDefined();
    });

    it('should find User as a subtype of BaseModel via subTypesGet', () => {
      const baseFile = fixtureFile('models', 'base.ts');
      const baseExports = index.exportedSymbolsGet({ file: baseFile });
      const baseModelSym = baseExports.find(s => s.name === 'BaseModel');
      expect(baseModelSym).toBeDefined();

      const subTypes = index.subTypesGet(baseModelSym!.id);
      expect(subTypes.length).toBeGreaterThanOrEqual(1);
      expect(subTypes.some(r => r.targetName === 'BaseModel' && r.relationKind === 'extends')).toBe(true);
    });
  });

  // ==========================================================================
  // 5. Generator functions
  // ==========================================================================

  describe('generator functions', () => {
    it('should extract generators with the Generator flag', () => {
      const helpersFile = fixtureFile('services', 'helpers.ts');
      const symbols = index.symbolsInFileGet(helpersFile);

      const range = symbols.find(s => s.name === 'range' && s.kind === 'function');
      expect(range).toBeDefined();
      expect(range!.flags & SymbolFlags.Generator).toBeTruthy();
      expect(range!.flags & SymbolFlags.Exported).toBeTruthy();

      const fibonacci = symbols.find(s => s.name === 'fibonacci' && s.kind === 'function');
      expect(fibonacci).toBeDefined();
      expect(fibonacci!.flags & SymbolFlags.Generator).toBeTruthy();
    });
  });

  // ==========================================================================
  // 6. Async functions and default export
  // ==========================================================================

  describe('async functions and default export', () => {
    it('should mark async functions with the Async flag', () => {
      const authFile = fixtureFile('services', 'auth.ts');
      const symbols = index.symbolsInFileGet(authFile);

      const authenticate = symbols.find(s => s.name === 'authenticate');
      expect(authenticate).toBeDefined();
      expect(authenticate!.flags & SymbolFlags.Async).toBeTruthy();

      const refreshToken = symbols.find(s => s.name === 'refreshToken');
      expect(refreshToken).toBeDefined();
      expect(refreshToken!.flags & SymbolFlags.Async).toBeTruthy();
    });

    it('should extract default export for verifyUser', () => {
      const authFile = fixtureFile('services', 'auth.ts');
      const exports = index.fileExportsGet(authFile);

      const defaultExport = exports.find(e => e.isDefault);
      expect(defaultExport).toBeDefined();
      expect(defaultExport!.exportedName).toBe('default');
    });

    it('should extract named exports alongside default', () => {
      const authFile = fixtureFile('services', 'auth.ts');
      const exports = index.fileExportsGet(authFile);
      const names = exports.map(e => e.exportedName);

      expect(names).toContain('authenticate');
      expect(names).toContain('refreshToken');
      expect(names).toContain('default');
    });
  });

  // ==========================================================================
  // 7. Abstract class, methods, constructor
  // ==========================================================================

  describe('abstract class and methods', () => {
    it('should extract BaseModel as an abstract class', () => {
      const baseFile = fixtureFile('models', 'base.ts');
      const symbols = index.symbolsInFileGet(baseFile);
      const baseModel = symbols.find(s => s.name === 'BaseModel' && s.kind === 'class');
      expect(baseModel).toBeDefined();
      expect(baseModel!.flags & SymbolFlags.Exported).toBeTruthy();
    });

    it('should extract constructor and methods', () => {
      const baseFile = fixtureFile('models', 'base.ts');
      const symbols = index.symbolsInFileGet(baseFile);
      const methods = symbols.filter(s => s.kind === 'method');
      const methodNames = methods.map(m => m.name);

      expect(methodNames).toContain('constructor');
      expect(methodNames).toContain('age');
      expect(methodNames).toContain('generateId');
    });

    it('should extract methods from User subclass', () => {
      const userFile = fixtureFile('models', 'user.ts');
      const symbols = index.symbolsInFileGet(userFile);
      const methods = symbols.filter(s => s.kind === 'method');
      const methodNames = methods.map(m => m.name);

      expect(methodNames).toContain('constructor');
      expect(methodNames).toContain('validate');
      expect(methodNames).toContain('toJSON');
      expect(methodNames).toContain('greet');
    });
  });

  // ==========================================================================
  // 8. Interfaces, type aliases, enums
  // ==========================================================================

  describe('interfaces, type aliases, enums', () => {
    it('should extract interfaces from types.ts', () => {
      const typesFile = fixtureFile('types.ts');
      const symbols = index.symbolsInFileGet(typesFile);
      const interfaces = symbols.filter(s => s.kind === 'interface');
      const names = interfaces.map(i => i.name);

      expect(names).toContain('Identifiable');
      expect(names).toContain('Timestamped');
      expect(names).toContain('Serializable');
    });

    it('should extract type aliases from types.ts', () => {
      const typesFile = fixtureFile('types.ts');
      const symbols = index.symbolsInFileGet(typesFile);
      const types = symbols.filter(s => s.kind === 'type');
      const names = types.map(t => t.name);

      expect(names).toContain('Result');
      expect(names).toContain('Nullable');
    });

    it('should extract enum and enum members from config.ts', () => {
      const configFile = fixtureFile('config.ts');
      const symbols = index.symbolsInFileGet(configFile);

      const enumSym = symbols.find(s => s.kind === 'enum' && s.name === 'LogLevel');
      expect(enumSym).toBeDefined();
      expect(enumSym!.flags & SymbolFlags.Exported).toBeTruthy();

      const members = symbols.filter(s => s.kind === 'enumMember');
      const memberNames = members.map(m => m.name);
      expect(memberNames).toContain('Debug');
      expect(memberNames).toContain('Info');
      expect(memberNames).toContain('Warn');
      expect(memberNames).toContain('Error');
    });

    it('should extract type alias AppEnv from config.ts', () => {
      const configFile = fixtureFile('config.ts');
      const symbols = index.symbolsInFileGet(configFile);
      const appEnv = symbols.find(s => s.name === 'AppEnv' && s.kind === 'type');
      expect(appEnv).toBeDefined();
      expect(appEnv!.flags & SymbolFlags.Exported).toBeTruthy();
    });
  });

  // ==========================================================================
  // 9. Large symbol count (config.ts)
  // ==========================================================================

  describe('large symbol count', () => {
    it('should extract all module-level variables from config.ts', () => {
      const configFile = fixtureFile('config.ts');
      const symbols = index.symbolsInFileGet(configFile);
      const varNames = symbols
        .filter(s => s.kind === 'variable' || s.kind === 'const')
        .map(s => s.name);

      const expected = [
        'VERSION', 'DEBUG', 'MAX_RETRIES', 'TIMEOUT_MS',
        'APP_NAME', 'DEFAULT_PORT', 'LOG_LEVEL', 'ENABLE_CACHE',
        'SECRET_KEY', 'DATABASE_URL',
      ];
      for (const name of expected) {
        expect(varNames).toContain(name);
      }
    });

    it('should export all symbols from config.ts', () => {
      const configFile = fixtureFile('config.ts');
      const exported = index.exportedSymbolsGet({ file: configFile });
      const names = exported.map(s => s.name);

      expect(names).toContain('VERSION');
      expect(names).toContain('LogLevel');
      expect(names).toContain('AppEnv');
      expect(names.length).toBeGreaterThanOrEqual(16);
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
        s => s.name === funcName && (s.kind === 'function' || s.kind === 'method')
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

    it('should produce CFG with branches for clamp (two if-conditions)', () => {
      const mathFile = fixtureFile('utils', 'math.ts');
      const cfg = cfgGetForFunction(mathFile, 'clamp');

      expect(cfg).toBeDefined();
      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes.length).toBeGreaterThanOrEqual(2);
    });

    it('should produce CFG with loop for sum (for...of)', () => {
      const mathFile = fixtureFile('utils', 'math.ts');
      const cfg = cfgGetForFunction(mathFile, 'sum');

      expect(cfg).toBeDefined();
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce CFG for authenticate (try/catch)', () => {
      const authFile = fixtureFile('services', 'auth.ts');
      const cfg = cfgGetForFunction(authFile, 'authenticate');

      expect(cfg).toBeDefined();
      expect(cfg!.nodes.some(n => n.kind === 'entry')).toBe(true);
      expect(cfg!.nodes.some(n => n.kind === 'exit')).toBe(true);
      expect(cfg!.nodes.length).toBeGreaterThan(2);
    });

    it('should produce CFG with throw for refreshToken', () => {
      const authFile = fixtureFile('services', 'auth.ts');
      const cfg = cfgGetForFunction(authFile, 'refreshToken');

      expect(cfg).toBeDefined();
      expect(cfg!.nodes.some(n => n.kind === 'throw')).toBe(true);
    });

    it('should produce CFG with loop for groupBy (for...of)', () => {
      const collectionsFile = fixtureFile('utils', 'collections.ts');
      const cfg = cfgGetForFunction(collectionsFile, 'groupBy');

      expect(cfg).toBeDefined();
      expect(cfg!.nodes.some(n => n.kind === 'loop')).toBe(true);
    });

    it('should produce CFGs for multiple functions in the same file', () => {
      const mathFile = fixtureFile('utils', 'math.ts');
      const scopes = index.scopesInFileGet(mathFile);
      const fnScopes = scopes.filter(s => s.kind === 'function');
      const cfgs = fnScopes
        .map(s => index.cfgGet(s.id))
        .filter((c): c is FlowGraph => c !== undefined);

      expect(cfgs.length).toBeGreaterThanOrEqual(3);
    });
  });
});

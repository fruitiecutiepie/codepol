import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
} from '@codepol/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('module graph', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-modgraph-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Linear chain: A -> B -> C
  // ==========================================================================

  it('should resolve importers and importees for a linear chain', () => {
    const fileC = path.join(testDir, 'chain_c.ts');
    fs.writeFileSync(fileC, `
export function leaf() { return 'leaf'; }
`);

    const fileB = path.join(testDir, 'chain_b.ts');
    fs.writeFileSync(fileB, `
import { leaf } from './chain_c';
export function middle() { return leaf(); }
`);

    const fileA = path.join(testDir, 'chain_a.ts');
    fs.writeFileSync(fileA, `
import { middle } from './chain_b';
const result = middle();
`);

    const { index } = projectIndexBuildSync({
      files: [fileA, fileB, fileC],
      dir: testDir,
    });

    // Forward edges (importees)
    expect(index.moduleImporteesGet(fileA)).toEqual([fileB]);
    expect(index.moduleImporteesGet(fileB)).toEqual([fileC]);
    expect(index.moduleImporteesGet(fileC)).toEqual([]);

    // Reverse edges (importers)
    expect(index.moduleImportersGet(fileA)).toEqual([]);
    expect(index.moduleImportersGet(fileB)).toEqual([fileA]);
    expect(index.moduleImportersGet(fileC)).toEqual([fileB]);
  });

  it('should produce correct dependency order for a linear chain', () => {
    const fileC = path.join(testDir, 'order_c.ts');
    fs.writeFileSync(fileC, `
export function leaf() { return 'leaf'; }
`);

    const fileB = path.join(testDir, 'order_b.ts');
    fs.writeFileSync(fileB, `
import { leaf } from './order_c';
export function middle() { return leaf(); }
`);

    const fileA = path.join(testDir, 'order_a.ts');
    fs.writeFileSync(fileA, `
import { middle } from './order_b';
const result = middle();
`);

    const { index } = projectIndexBuildSync({
      files: [fileA, fileB, fileC],
      dir: testDir,
    });

    const order = index.moduleDependencyOrderGet();
    expect(order).toHaveLength(3);

    // C has no deps -> comes before B -> comes before A
    const idxA = order.indexOf(fileA);
    const idxB = order.indexOf(fileB);
    const idxC = order.indexOf(fileC);
    expect(idxC).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxA);
  });

  it('should report no cycles for a linear chain', () => {
    const fileC = path.join(testDir, 'nocycle_c.ts');
    fs.writeFileSync(fileC, `
export function leaf() { return 'leaf'; }
`);

    const fileB = path.join(testDir, 'nocycle_b.ts');
    fs.writeFileSync(fileB, `
import { leaf } from './nocycle_c';
export function middle() { return leaf(); }
`);

    const fileA = path.join(testDir, 'nocycle_a.ts');
    fs.writeFileSync(fileA, `
import { middle } from './nocycle_b';
const result = middle();
`);

    const { index } = projectIndexBuildSync({
      files: [fileA, fileB, fileC],
      dir: testDir,
    });

    expect(index.moduleCyclesGet()).toEqual([]);
  });

  // ==========================================================================
  // Circular imports: A <-> B
  // ==========================================================================

  it('should detect circular dependency between two files', () => {
    const circA = path.join(testDir, 'circ_a.ts');
    const circB = path.join(testDir, 'circ_b.ts');

    fs.writeFileSync(circA, `
import { betaFn } from './circ_b';
export function alphaFn() { return betaFn(); }
`);

    fs.writeFileSync(circB, `
import { alphaFn } from './circ_a';
export function betaFn() { return 'beta'; }
`);

    const { index } = projectIndexBuildSync({
      files: [circA, circB],
      dir: testDir,
    });

    const cycles = index.moduleCyclesGet();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(2);
    expect(cycles[0]).toContain(circA);
    expect(cycles[0]).toContain(circB);

    // Both files import each other
    expect(index.moduleImporteesGet(circA)).toContain(circB);
    expect(index.moduleImporteesGet(circB)).toContain(circA);
  });

  // ==========================================================================
  // Diamond dependency: A -> B+C, B -> D, C -> D
  // ==========================================================================

  it('should handle diamond dependencies without false cycles', () => {
    const fileD = path.join(testDir, 'diamond_d.ts');
    fs.writeFileSync(fileD, `
export function shared() { return 'shared'; }
`);

    const fileB = path.join(testDir, 'diamond_b.ts');
    fs.writeFileSync(fileB, `
import { shared } from './diamond_d';
export function branchB() { return shared(); }
`);

    const fileCC = path.join(testDir, 'diamond_cc.ts');
    fs.writeFileSync(fileCC, `
import { shared } from './diamond_d';
export function branchC() { return shared(); }
`);

    const fileA = path.join(testDir, 'diamond_a.ts');
    fs.writeFileSync(fileA, `
import { branchB } from './diamond_b';
import { branchC } from './diamond_cc';
const result = branchB() + branchC();
`);

    const { index } = projectIndexBuildSync({
      files: [fileA, fileB, fileCC, fileD],
      dir: testDir,
    });

    // No cycles in a diamond
    expect(index.moduleCyclesGet()).toEqual([]);

    // A imports B and C
    const aImportees = index.moduleImporteesGet(fileA);
    expect(aImportees).toContain(fileB);
    expect(aImportees).toContain(fileCC);
    expect(aImportees).toHaveLength(2);

    // D is imported by both B and C
    const dImporters = index.moduleImportersGet(fileD);
    expect(dImporters).toContain(fileB);
    expect(dImporters).toContain(fileCC);
    expect(dImporters).toHaveLength(2);

    // Dependency order: D before B and C, B and C before A
    const order = index.moduleDependencyOrderGet();
    const idxA = order.indexOf(fileA);
    const idxB = order.indexOf(fileB);
    const idxC = order.indexOf(fileCC);
    const idxD = order.indexOf(fileD);
    expect(idxD).toBeLessThan(idxB);
    expect(idxD).toBeLessThan(idxC);
    expect(idxB).toBeLessThan(idxA);
    expect(idxC).toBeLessThan(idxA);
  });

  // ==========================================================================
  // Isolated file (no imports or exports)
  // ==========================================================================

  it('should include isolated files in the graph', () => {
    const isolated = path.join(testDir, 'isolated.ts');
    fs.writeFileSync(isolated, `
const x = 42;
function localOnly() { return x; }
`);

    const connected = path.join(testDir, 'connected.ts');
    fs.writeFileSync(connected, `
export function pub() { return 'pub'; }
`);

    const { index } = projectIndexBuildSync({
      files: [isolated, connected],
      dir: testDir,
    });

    // Isolated file appears in dependency order
    const order = index.moduleDependencyOrderGet();
    expect(order).toContain(isolated);
    expect(order).toContain(connected);
    expect(order).toHaveLength(2);

    // No importers or importees
    expect(index.moduleImportersGet(isolated)).toEqual([]);
    expect(index.moduleImporteesGet(isolated)).toEqual([]);

    // No cycles
    expect(index.moduleCyclesGet()).toEqual([]);
  });

  // ==========================================================================
  // External packages filtered out
  // ==========================================================================

  it('should exclude external packages from the module graph', () => {
    const fileWithExternal = path.join(testDir, 'ext_consumer.ts');
    fs.writeFileSync(fileWithExternal, `
import path from 'node:path';
import { something } from 'lodash';

export function consumer() { return path.join('a', 'b'); }
`);

    const localDep = path.join(testDir, 'ext_local.ts');
    fs.writeFileSync(localDep, `
export function localHelper() { return 'local'; }
`);

    const { index } = projectIndexBuildSync({
      files: [fileWithExternal, localDep],
      dir: testDir,
    });

    // External packages should not appear as importees
    const importees = index.moduleImporteesGet(fileWithExternal);
    expect(importees).toEqual([]); // No local imports

    // No cycles
    expect(index.moduleCyclesGet()).toEqual([]);
  });

  // ==========================================================================
  // Unknown file returns empty (not in index)
  // ==========================================================================

  it('should return empty arrays for files not in the index', () => {
    const known = path.join(testDir, 'known_file.ts');
    fs.writeFileSync(known, `export const x = 1;`);

    const { index } = projectIndexBuildSync({
      files: [known],
      dir: testDir,
    });

    const unknownFile = '/nonexistent/path.ts';
    expect(index.moduleImportersGet(unknownFile)).toEqual([]);
    expect(index.moduleImporteesGet(unknownFile)).toEqual([]);
  });

  // ==========================================================================
  // Multiple imports between same files are deduplicated
  // ==========================================================================

  it('should deduplicate multiple imports between the same files', () => {
    const multi = path.join(testDir, 'multi_exports.ts');
    fs.writeFileSync(multi, `
export function fnA() { return 'a'; }
export function fnB() { return 'b'; }
export function fnC() { return 'c'; }
`);

    const multiConsumer = path.join(testDir, 'multi_consumer.ts');
    fs.writeFileSync(multiConsumer, `
import { fnA, fnB, fnC } from './multi_exports';
const result = fnA() + fnB() + fnC();
`);

    const { index } = projectIndexBuildSync({
      files: [multi, multiConsumer],
      dir: testDir,
    });

    // Only one edge despite 3 imports from the same file
    expect(index.moduleImporteesGet(multiConsumer)).toEqual([multi]);
    expect(index.moduleImportersGet(multi)).toEqual([multiConsumer]);
  });

  // ==========================================================================
  // Entry point detection
  // ==========================================================================

  it('should identify entry points in a linear chain (only root)', () => {
    const epC = path.join(testDir, 'ep_chain_c.ts');
    fs.writeFileSync(epC, `export function leaf() { return 'leaf'; }\n`);

    const epB = path.join(testDir, 'ep_chain_b.ts');
    fs.writeFileSync(epB, `
import { leaf } from './ep_chain_c';
export function middle() { return leaf(); }
`);

    const epA = path.join(testDir, 'ep_chain_a.ts');
    fs.writeFileSync(epA, `
import { middle } from './ep_chain_b';
const result = middle();
`);

    const { index } = projectIndexBuildSync({
      files: [epA, epB, epC],
      dir: testDir,
    });

    const entryPoints = index.moduleEntryPointsGet();
    // Only A is an entry point (nothing imports A)
    expect(entryPoints).toEqual([epA]);
  });

  it('should identify entry points in a diamond (only root)', () => {
    const epD = path.join(testDir, 'ep_diamond_d.ts');
    fs.writeFileSync(epD, `export function shared() { return 'shared'; }\n`);

    const epB = path.join(testDir, 'ep_diamond_b.ts');
    fs.writeFileSync(epB, `
import { shared } from './ep_diamond_d';
export function branchB() { return shared(); }
`);

    const epC = path.join(testDir, 'ep_diamond_c.ts');
    fs.writeFileSync(epC, `
import { shared } from './ep_diamond_d';
export function branchC() { return shared(); }
`);

    const epA = path.join(testDir, 'ep_diamond_a.ts');
    fs.writeFileSync(epA, `
import { branchB } from './ep_diamond_b';
import { branchC } from './ep_diamond_c';
const result = branchB() + branchC();
`);

    const { index } = projectIndexBuildSync({
      files: [epA, epB, epC, epD],
      dir: testDir,
    });

    const entryPoints = index.moduleEntryPointsGet();
    // Only A is an entry point
    expect(entryPoints).toEqual([epA]);
  });

  it('should treat isolated files as entry points', () => {
    const epIso = path.join(testDir, 'ep_isolated.ts');
    fs.writeFileSync(epIso, `const x = 42;\n`);

    const epConnected = path.join(testDir, 'ep_connected.ts');
    fs.writeFileSync(epConnected, `export function pub() { return 'pub'; }\n`);

    const { index } = projectIndexBuildSync({
      files: [epIso, epConnected],
      dir: testDir,
    });

    const entryPoints = index.moduleEntryPointsGet();
    // Both files are entry points (neither is imported by the other)
    expect(entryPoints).toHaveLength(2);
    expect(entryPoints).toContain(epIso);
    expect(entryPoints).toContain(epConnected);
  });

  it('should not treat circular import files as entry points', () => {
    const epCircA = path.join(testDir, 'ep_circ_a.ts');
    const epCircB = path.join(testDir, 'ep_circ_b.ts');

    fs.writeFileSync(epCircA, `
import { betaFn } from './ep_circ_b';
export function alphaFn() { return betaFn(); }
`);

    fs.writeFileSync(epCircB, `
import { alphaFn } from './ep_circ_a';
export function betaFn() { return 'beta'; }
`);

    const { index } = projectIndexBuildSync({
      files: [epCircA, epCircB],
      dir: testDir,
    });

    const entryPoints = index.moduleEntryPointsGet();
    // Neither file is an entry point (both have importers)
    expect(entryPoints).toEqual([]);
  });

  it('should treat files with only external imports as entry points', () => {
    const epExtOnly = path.join(testDir, 'ep_ext_only.ts');
    fs.writeFileSync(epExtOnly, `
import path from 'node:path';
import { something } from 'lodash';
export function consumer() { return path.join('a', 'b'); }
`);

    const epLeaf = path.join(testDir, 'ep_leaf.ts');
    fs.writeFileSync(epLeaf, `export function helper() { return 'help'; }\n`);

    const { index } = projectIndexBuildSync({
      files: [epExtOnly, epLeaf],
      dir: testDir,
    });

    const entryPoints = index.moduleEntryPointsGet();
    // Both files are entry points (external imports don't count as importers)
    expect(entryPoints).toHaveLength(2);
    expect(entryPoints).toContain(epExtOnly);
    expect(entryPoints).toContain(epLeaf);
  });

  // ==========================================================================
  // Dynamic import() in module graph
  // ==========================================================================

  it('should include dynamic imports in the module graph', () => {
    const mgDynTarget = path.join(testDir, 'mg_dyn_target.ts');
    fs.writeFileSync(mgDynTarget, `
export function lazyFn() { return 'lazy'; }
`);

    const mgDynCaller = path.join(testDir, 'mg_dyn_caller.ts');
    fs.writeFileSync(mgDynCaller, `
async function loadIt() {
  const mod = await import('./mg_dyn_target');
  return mod.lazyFn();
}
`);

    const { index } = projectIndexBuildSync({
      files: [mgDynTarget, mgDynCaller],
      dir: testDir,
    });

    // Dynamic import should create a module graph edge
    const importees = index.moduleImporteesGet(mgDynCaller);
    expect(importees).toContain(mgDynTarget);

    const importers = index.moduleImportersGet(mgDynTarget);
    expect(importers).toContain(mgDynCaller);

    // Caller is an entry point (nothing imports it)
    const entryPoints = index.moduleEntryPointsGet();
    expect(entryPoints).toContain(mgDynCaller);
    expect(entryPoints).not.toContain(mgDynTarget);
  });

  it('should include side-effect dynamic imports in the module graph', () => {
    const mgSideTarget = path.join(testDir, 'mg_side_target.ts');
    fs.writeFileSync(mgSideTarget, `
export const polyfill = true;
`);

    const mgSideCaller = path.join(testDir, 'mg_side_caller.ts');
    fs.writeFileSync(mgSideCaller, `
async function loadPolyfills() {
  await import('./mg_side_target');
}
`);

    const { index } = projectIndexBuildSync({
      files: [mgSideTarget, mgSideCaller],
      dir: testDir,
    });

    // Side-effect dynamic import (no binding) should still appear via
    // ImportsRelation.resolvedModulePath in the module graph
    const importees = index.moduleImporteesGet(mgSideCaller);
    expect(importees).toContain(mgSideTarget);

    const importers = index.moduleImportersGet(mgSideTarget);
    expect(importers).toContain(mgSideCaller);
  });

  it('should include static side-effect imports in the module graph', () => {
    const mgStaticSideTarget = path.join(testDir, 'mg_static_side_target.ts');
    fs.writeFileSync(mgStaticSideTarget, `
export const init = true;
`);

    const mgStaticSideCaller = path.join(testDir, 'mg_static_side_caller.ts');
    fs.writeFileSync(mgStaticSideCaller, `
import './mg_static_side_target';
const x = 1;
`);

    const { index } = projectIndexBuildSync({
      files: [mgStaticSideTarget, mgStaticSideCaller],
      dir: testDir,
    });

    // Static side-effect import (import "module") should appear in module graph
    // via ImportsRelation.resolvedModulePath
    const importees = index.moduleImporteesGet(mgStaticSideCaller);
    expect(importees).toContain(mgStaticSideTarget);
  });
});

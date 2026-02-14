import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type FlowGraph,
} from '@codepol/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('control flow graph extraction', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-cfg-test-'));
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  /** Helper to build index and get the first CFG */
  function buildAndGetCfg(source: string, fileName?: string): FlowGraph | undefined {
    const file = path.join(testDir, fileName ?? `cfg_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`);
    fs.writeFileSync(file, source);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const scopes = index.scopesInFileGet(file);
    const fnScope = scopes.find(s => s.kind === 'function');
    if (!fnScope) return undefined;
    return index.cfgGet(fnScope.id);
  }

  /** Helper to build index and get all CFGs for a file */
  function buildAndGetAllCfgs(source: string, fileName?: string): { cfgs: FlowGraph[]; index: ReturnType<typeof projectIndexBuildSync>['index']; file: string } {
    const file = path.join(testDir, fileName ?? `cfg_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`);
    fs.writeFileSync(file, source);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const scopes = index.scopesInFileGet(file);
    const fnScopes = scopes.filter(s => s.kind === 'function');
    const cfgs = fnScopes.map(s => index.cfgGet(s.id)).filter((c): c is FlowGraph => c !== undefined);
    return { cfgs, index, file };
  }

  // ==========================================================================
  // Basic Patterns
  // ==========================================================================

  describe('basic patterns', () => {
    it('empty function — entry + exit connected by single edge', () => {
      const cfg = buildAndGetCfg(`function empty() {}`, 'cfg_empty.ts');
      expect(cfg).toBeDefined();
      expect(cfg!.nodes.some(n => n.kind === 'entry')).toBe(true);
      expect(cfg!.nodes.some(n => n.kind === 'exit')).toBe(true);
      // entry → exit (1 edge)
      expect(cfg!.edges).toHaveLength(1);
      const entry = cfg!.nodes.find(n => n.kind === 'entry')!;
      const exit = cfg!.nodes.find(n => n.kind === 'exit')!;
      expect(cfg!.edges[0].from).toBe(entry.id);
      expect(cfg!.edges[0].to).toBe(exit.id);
    });

    it('sequential statements — linear chain', () => {
      const cfg = buildAndGetCfg(`
function sequential() {
  const a = 1;
  const b = 2;
  const c = 3;
}
`, 'cfg_sequential.ts');
      expect(cfg).toBeDefined();

      const entry = cfg!.nodes.find(n => n.kind === 'entry')!;
      const exit = cfg!.nodes.find(n => n.kind === 'exit')!;
      const statements = cfg!.nodes.filter(n => n.kind === 'statement');

      // 3 statements + entry + exit = 5 nodes
      expect(statements.length).toBe(3);
      expect(cfg!.nodes).toHaveLength(5);

      // Linear chain: entry → s1 → s2 → s3 → exit = 4 edges
      expect(cfg!.edges).toHaveLength(4);

      // Verify entry connects to first statement
      const entryEdges = cfg!.edges.filter(e => e.from === entry.id);
      expect(entryEdges).toHaveLength(1);

      // Verify last statement connects to exit
      const exitEdges = cfg!.edges.filter(e => e.to === exit.id);
      expect(exitEdges).toHaveLength(1);
    });

    it('return inside function — edge to exit, no implicit return', () => {
      const cfg = buildAndGetCfg(`
function earlyReturn() {
  const x = 1;
  return x;
}
`, 'cfg_return.ts');
      expect(cfg).toBeDefined();

      const exit = cfg!.nodes.find(n => n.kind === 'exit')!;
      const returnNode = cfg!.nodes.find(n => n.kind === 'return');
      expect(returnNode).toBeDefined();

      // return node connects to exit
      const returnToExit = cfg!.edges.filter(e => e.from === returnNode!.id && e.to === exit.id);
      expect(returnToExit).toHaveLength(1);
    });

    it('throw inside function — edge to exit', () => {
      const cfg = buildAndGetCfg(`
function throwFn() {
  throw new Error('boom');
}
`, 'cfg_throw.ts');
      expect(cfg).toBeDefined();

      const exit = cfg!.nodes.find(n => n.kind === 'exit')!;
      const throwNode = cfg!.nodes.find(n => n.kind === 'throw');
      expect(throwNode).toBeDefined();

      const throwToExit = cfg!.edges.filter(e => e.from === throwNode!.id && e.to === exit.id);
      expect(throwToExit).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Branching (if/else)
  // ==========================================================================

  describe('if/else branching', () => {
    it('single if (no else) — branch + merge', () => {
      const cfg = buildAndGetCfg(`
function singleIf(x: number) {
  if (x > 0) {
    console.log('positive');
  }
}
`, 'cfg_single_if.ts');
      expect(cfg).toBeDefined();

      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes).toHaveLength(1);

      const mergeNodes = cfg!.nodes.filter(n => n.kind === 'merge');
      expect(mergeNodes).toHaveLength(1);

      // Branch should have true and false edges
      const branchEdges = cfg!.edges.filter(e => e.from === branchNodes[0].id);
      expect(branchEdges.length).toBeGreaterThanOrEqual(2);
      expect(branchEdges.some(e => e.label === 'true')).toBe(true);
      expect(branchEdges.some(e => e.label === 'false')).toBe(true);
    });

    it('if/else — branch with true/false paths + merge', () => {
      const cfg = buildAndGetCfg(`
function ifElse(x: number) {
  if (x > 0) {
    console.log('positive');
  } else {
    console.log('non-positive');
  }
}
`, 'cfg_if_else.ts');
      expect(cfg).toBeDefined();

      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes).toHaveLength(1);

      const mergeNodes = cfg!.nodes.filter(n => n.kind === 'merge');
      expect(mergeNodes).toHaveLength(1);

      const branchEdges = cfg!.edges.filter(e => e.from === branchNodes[0].id);
      expect(branchEdges.some(e => e.label === 'true')).toBe(true);
      expect(branchEdges.some(e => e.label === 'false')).toBe(true);
    });
  });

  // ==========================================================================
  // Loops
  // ==========================================================================

  describe('loops', () => {
    it('while loop — loop node + back-edge', () => {
      const cfg = buildAndGetCfg(`
function whileLoop() {
  let i = 0;
  while (i < 10) {
    i++;
  }
}
`, 'cfg_while.ts');
      expect(cfg).toBeDefined();

      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(1);

      // Should have a back-edge
      const backEdges = cfg!.edges.filter(e => e.label === 'loop-back');
      expect(backEdges).toHaveLength(1);
      expect(backEdges[0].to).toBe(loopNodes[0].id);

      // Loop should have true (into body) and false (exit) edges
      const loopEdges = cfg!.edges.filter(e => e.from === loopNodes[0].id);
      expect(loopEdges.some(e => e.label === 'true')).toBe(true);
      expect(loopEdges.some(e => e.label === 'false')).toBe(true);
    });

    it('for loop — loop node + back-edge', () => {
      const cfg = buildAndGetCfg(`
function forLoop() {
  for (let i = 0; i < 10; i++) {
    console.log(i);
  }
}
`, 'cfg_for.ts');
      expect(cfg).toBeDefined();

      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(1);

      const backEdges = cfg!.edges.filter(e => e.label === 'loop-back');
      expect(backEdges).toHaveLength(1);
      expect(backEdges[0].to).toBe(loopNodes[0].id);
    });

    it('do...while — body first, condition, back-edge', () => {
      const cfg = buildAndGetCfg(`
function doWhileLoop() {
  let i = 0;
  do {
    i++;
  } while (i < 10);
}
`, 'cfg_do_while.ts');
      expect(cfg).toBeDefined();

      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(1);

      // Back-edge: loop condition (true) → body entry
      const trueEdges = cfg!.edges.filter(e => e.from === loopNodes[0].id && e.label === 'true');
      expect(trueEdges).toHaveLength(1);

      // Exit: loop condition (false) → merge
      const falseEdges = cfg!.edges.filter(e => e.from === loopNodes[0].id && e.label === 'false');
      expect(falseEdges).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Nested Control Flow
  // ==========================================================================

  describe('nested control flow', () => {
    it('nested if inside while', () => {
      const cfg = buildAndGetCfg(`
function nested() {
  let i = 0;
  while (i < 10) {
    if (i % 2 === 0) {
      console.log('even');
    }
    i++;
  }
}
`, 'cfg_nested.ts');
      expect(cfg).toBeDefined();

      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(1);

      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes).toHaveLength(1);

      // Should have a back-edge to the loop
      const backEdges = cfg!.edges.filter(e => e.label === 'loop-back');
      expect(backEdges).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Cyclomatic Complexity
  // ==========================================================================

  describe('cyclomatic complexity', () => {
    it('linear function — complexity 1', () => {
      const { index, file } = buildAndGetAllCfgs(`
function linear() {
  const a = 1;
  const b = 2;
  return a + b;
}
`, 'cfg_cc_linear.ts');

      const symbols = index.symbolsInFileGet(file);
      const fn = symbols.find(s => s.name === 'linear' && s.kind === 'function');
      expect(fn).toBeDefined();

      const cc = index.cyclomaticComplexityGet(fn!.id);
      expect(cc).toBe(1);
    });

    it('if/else — complexity 2', () => {
      const { index, file } = buildAndGetAllCfgs(`
function branching(x: number) {
  if (x > 0) {
    return 'positive';
  } else {
    return 'negative';
  }
}
`, 'cfg_cc_branch.ts');

      const symbols = index.symbolsInFileGet(file);
      const fn = symbols.find(s => s.name === 'branching' && s.kind === 'function');
      expect(fn).toBeDefined();

      const cc = index.cyclomaticComplexityGet(fn!.id);
      // if/else adds one decision point: V(G) = 2
      expect(cc).toBe(2);
    });

    it('while + if — complexity 3', () => {
      const { index, file } = buildAndGetAllCfgs(`
function complex(n: number) {
  let sum = 0;
  while (n > 0) {
    if (n % 2 === 0) {
      sum += n;
    }
    n--;
  }
  return sum;
}
`, 'cfg_cc_complex.ts');

      const symbols = index.symbolsInFileGet(file);
      const fn = symbols.find(s => s.name === 'complex' && s.kind === 'function');
      expect(fn).toBeDefined();

      const cc = index.cyclomaticComplexityGet(fn!.id);
      // while (1 branch) + if (1 branch) = 2 decision points → V(G) = 3
      expect(cc).toBe(3);
    });
  });

  // ==========================================================================
  // Arrow Functions
  // ==========================================================================

  describe('arrow functions', () => {
    it('arrow function with block body', () => {
      const cfg = buildAndGetCfg(`
const greet = (name: string) => {
  console.log('hello ' + name);
};
`, 'cfg_arrow_block.ts');
      expect(cfg).toBeDefined();

      const entry = cfg!.nodes.find(n => n.kind === 'entry')!;
      const exit = cfg!.nodes.find(n => n.kind === 'exit')!;
      expect(entry).toBeDefined();
      expect(exit).toBeDefined();
    });

    it('arrow function with expression body', () => {
      const cfg = buildAndGetCfg(`
const add = (a: number, b: number) => a + b;
`, 'cfg_arrow_expr.ts');
      expect(cfg).toBeDefined();

      // Expression body: entry → expr → exit (3 nodes, 2 edges)
      expect(cfg!.nodes).toHaveLength(3);
      expect(cfg!.edges).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Multiple Functions
  // ==========================================================================

  describe('multiple functions', () => {
    it('generates CFG per function scope', () => {
      const { cfgs } = buildAndGetAllCfgs(`
function foo() {
  const x = 1;
}

function bar() {
  const y = 2;
  const z = 3;
}
`, 'cfg_multi.ts');

      expect(cfgs.length).toBe(2);
    });
  });

  // ==========================================================================
  // Deferred (skipped) Patterns
  // ==========================================================================

  describe('deferred patterns', () => {
    // TODO: Remove .skip once switch/case CFG support is implemented
    it.skip('switch/case branching', () => {
      const cfg = buildAndGetCfg(`
function switchCase(x: number) {
  switch (x) {
    case 1: return 'one';
    case 2: return 'two';
    default: return 'other';
  }
}
`, 'cfg_switch.ts');
      expect(cfg).toBeDefined();
      // Expect branch nodes for each case
      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes.length).toBeGreaterThanOrEqual(2);
    });

    // TODO: Remove .skip once break/continue support is implemented
    it.skip('break/continue in loops', () => {
      const cfg = buildAndGetCfg(`
function breakContinue() {
  for (let i = 0; i < 10; i++) {
    if (i === 5) break;
    if (i % 2 === 0) continue;
    console.log(i);
  }
}
`, 'cfg_break_continue.ts');
      expect(cfg).toBeDefined();
      // Expect break to create edge to loop exit, continue to loop header
    });

    // TODO: Remove .skip once try/catch/finally support is implemented
    it.skip('try/catch/finally', () => {
      const cfg = buildAndGetCfg(`
function tryCatch() {
  try {
    riskyOperation();
  } catch (e) {
    handleError(e);
  } finally {
    cleanup();
  }
}
`, 'cfg_try_catch.ts');
      expect(cfg).toBeDefined();
      // Expect exception flow edges
    });

    // TODO: Remove .skip once for...in/for...of support is implemented
    it.skip('for...in / for...of', () => {
      const cfg = buildAndGetCfg(`
function forOf(items: string[]) {
  for (const item of items) {
    console.log(item);
  }
}
`, 'cfg_for_of.ts');
      expect(cfg).toBeDefined();
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(1);
    });
  });
});

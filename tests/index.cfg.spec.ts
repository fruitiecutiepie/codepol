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
  function cfgGet(source: string, fileName?: string): FlowGraph | undefined {
    const file = path.join(testDir, fileName ?? `cfg_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`);
    fs.writeFileSync(file, source);
    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const scopes = index.scopesInFileGet(file);
    const fnScope = scopes.find(s => s.kind === 'function');
    if (!fnScope) return undefined;
    return index.cfgGet(fnScope.id);
  }

  /** Helper to build index and get all CFGs for a file */
  function cfgsGet(source: string, fileName?: string): { cfgs: FlowGraph[]; index: ReturnType<typeof projectIndexBuildSync>['index']; file: string } {
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
      const cfg = cfgGet(`function empty() {}`, 'cfg_empty.ts');
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const { index, file } = cfgsGet(`
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
      const { index, file } = cfgsGet(`
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
      const { index, file } = cfgsGet(`
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
      const cfg = cfgGet(`
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
      const cfg = cfgGet(`
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
      const { cfgs } = cfgsGet(`
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
  // for...in / for...of
  // ==========================================================================

  describe('for...in / for...of', () => {
    it('for...of — loop node + back-edge + true/false edges', () => {
      const cfg = cfgGet(`
function forOf(items: string[]) {
  for (const item of items) {
    console.log(item);
  }
}
`, 'cfg_for_of.ts');
      expect(cfg).toBeDefined();

      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(1);

      const backEdges = cfg!.edges.filter(e => e.label === 'loop-back');
      expect(backEdges).toHaveLength(1);
      expect(backEdges[0].to).toBe(loopNodes[0].id);

      const loopEdges = cfg!.edges.filter(e => e.from === loopNodes[0].id);
      expect(loopEdges.some(e => e.label === 'true')).toBe(true);
      expect(loopEdges.some(e => e.label === 'false')).toBe(true);
    });

    it('for...in — loop node + back-edge', () => {
      const cfg = cfgGet(`
function forIn(obj: Record<string, number>) {
  for (const key in obj) {
    console.log(key);
  }
}
`, 'cfg_for_in.ts');
      expect(cfg).toBeDefined();

      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(1);

      const backEdges = cfg!.edges.filter(e => e.label === 'loop-back');
      expect(backEdges).toHaveLength(1);
    });

    it('for...of with break — loop + break edge to merge', () => {
      const cfg = cfgGet(`
function forOfBreak(items: string[]) {
  for (const item of items) {
    if (item === 'stop') break;
    console.log(item);
  }
}
`, 'cfg_for_of_break.ts');
      expect(cfg).toBeDefined();

      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(1);

      const breakEdges = cfg!.edges.filter(e => e.label === 'break');
      expect(breakEdges).toHaveLength(1);

      // break target should be the loop's merge node (not the loop header)
      const mergeNodes = cfg!.nodes.filter(n => n.kind === 'merge');
      const loopMerge = mergeNodes.find(m => {
        const falseEdge = cfg!.edges.find(e => e.from === loopNodes[0].id && e.label === 'false');
        return falseEdge && falseEdge.to === m.id;
      });
      expect(loopMerge).toBeDefined();
      expect(breakEdges[0].to).toBe(loopMerge!.id);
    });
  });

  // ==========================================================================
  // switch/case
  // ==========================================================================

  describe('switch/case', () => {
    it('switch with cases returning — branch node + case edges', () => {
      const cfg = cfgGet(`
function switchCase(x: number) {
  switch (x) {
    case 1: return 'one';
    case 2: return 'two';
    default: return 'other';
  }
}
`, 'cfg_switch.ts');
      expect(cfg).toBeDefined();

      // Branch node for switch discriminant
      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes).toHaveLength(1);

      // Case edges from branch
      const caseEdges = cfg!.edges.filter(e => e.from === branchNodes[0].id && e.label === 'case');
      expect(caseEdges).toHaveLength(2); // case 1, case 2

      const defaultEdges = cfg!.edges.filter(e => e.from === branchNodes[0].id && e.label === 'default');
      expect(defaultEdges).toHaveLength(1);
    });

    it('switch with fallthrough (no break between cases)', () => {
      const cfg = cfgGet(`
function switchFallthrough(x: number) {
  let result = '';
  switch (x) {
    case 1:
      result += 'one';
    case 2:
      result += 'two';
      break;
    default:
      result += 'other';
  }
  return result;
}
`, 'cfg_switch_fallthrough.ts');
      expect(cfg).toBeDefined();

      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes).toHaveLength(1);

      // case 1 body falls through to case 2 body (unconditional edge between them)
      // case 2 has break → goes to merge
      const breakEdges = cfg!.edges.filter(e => e.label === 'break');
      expect(breakEdges).toHaveLength(1);
    });

    it('switch with default only', () => {
      const cfg = cfgGet(`
function switchDefault(x: number) {
  switch (x) {
    default:
      console.log('default');
  }
}
`, 'cfg_switch_default_only.ts');
      expect(cfg).toBeDefined();

      const branchNodes = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes).toHaveLength(1);

      const defaultEdges = cfg!.edges.filter(e => e.from === branchNodes[0].id && e.label === 'default');
      expect(defaultEdges).toHaveLength(1);
    });

    it('switch with all cases returning — merge node exists but may be unreachable', () => {
      const cfg = cfgGet(`
function switchAllReturn(x: number) {
  switch (x) {
    case 1: return 'a';
    case 2: return 'b';
    default: return 'c';
  }
}
`, 'cfg_switch_all_return.ts');
      expect(cfg).toBeDefined();

      // All cases return, so merge has no incoming unconditional edges from cases
      // (only the implicit merge node exists)
      const mergeNodes = cfg!.nodes.filter(n => n.kind === 'merge');
      expect(mergeNodes).toHaveLength(1);

      const returnNodes = cfg!.nodes.filter(n => n.kind === 'return');
      expect(returnNodes).toHaveLength(3);
    });

    it('cyclomatic complexity: switch with 3 cases = 3', () => {
      const { index, file } = cfgsGet(`
function switchCC(x: number) {
  switch (x) {
    case 1: return 'a';
    case 2: return 'b';
    default: return 'c';
  }
}
`, 'cfg_cc_switch.ts');

      const symbols = index.symbolsInFileGet(file);
      const fn = symbols.find(s => s.name === 'switchCC' && s.kind === 'function');
      expect(fn).toBeDefined();

      const cc = index.cyclomaticComplexityGet(fn!.id);
      // switch with 3 paths (case, case, default) → V(G) = 3
      expect(cc).toBe(3);
    });
  });

  // ==========================================================================
  // break / continue
  // ==========================================================================

  describe('break / continue', () => {
    it('break/continue in loops — correct edge targets', () => {
      const cfg = cfgGet(`
function breakContinue() {
  for (let i = 0; i < 10; i++) {
    if (i === 5) break;
    if (i % 2 === 0) continue;
    console.log(i);
  }
}
`, 'cfg_break_continue.ts');
      expect(cfg).toBeDefined();

      // break edge goes to loop merge
      const breakEdges = cfg!.edges.filter(e => e.label === 'break');
      expect(breakEdges).toHaveLength(1);

      // continue edge goes to the for-increment (or loop header)
      const continueEdges = cfg!.edges.filter(e => e.label === 'continue');
      expect(continueEdges).toHaveLength(1);

      // break target should NOT be the loop header
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(breakEdges[0].to).not.toBe(loopNodes[0].id);
    });

    it('break inside nested loop — only breaks inner loop', () => {
      const cfg = cfgGet(`
function nestedBreak() {
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (j === 3) break;
    }
  }
}
`, 'cfg_nested_break.ts');
      expect(cfg).toBeDefined();

      // Two loops
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(2);

      // One break
      const breakEdges = cfg!.edges.filter(e => e.label === 'break');
      expect(breakEdges).toHaveLength(1);

      // The break target should be the inner loop's merge, not the outer loop's merge
      // Inner loop's merge is the one with a false edge from the inner loop
      const innerLoop = loopNodes[1]; // second loop is inner
      const innerMerge = cfg!.nodes.find(n =>
        n.kind === 'merge' &&
        cfg!.edges.some(e => e.from === innerLoop.id && e.to === n.id && e.label === 'false')
      );
      expect(innerMerge).toBeDefined();
      expect(breakEdges[0].to).toBe(innerMerge!.id);
    });

    it('continue inside nested loop — only continues inner loop', () => {
      const cfg = cfgGet(`
function nestedContinue() {
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (j === 2) continue;
      console.log(j);
    }
  }
}
`, 'cfg_nested_continue.ts');
      expect(cfg).toBeDefined();

      const continueEdges = cfg!.edges.filter(e => e.label === 'continue');
      expect(continueEdges).toHaveLength(1);

      // Continue should target inner loop's increment/header, not outer
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(2);

      // For a `for` loop, continue goes to the increment node.
      // The increment node has a loop-back edge to the inner loop.
      const innerLoop = loopNodes[1];
      const continueTarget = continueEdges[0].to;

      // The continue target should eventually reach the inner loop via loop-back
      const reachesInnerLoop = cfg!.edges.some(
        e => e.from === continueTarget && e.to === innerLoop.id && e.label === 'loop-back'
      );
      expect(reachesInnerLoop).toBe(true);
    });

    it('labeled break exits outer loop', () => {
      const cfg = cfgGet(`
function labeledBreak() {
  outer: for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (j === 3) break outer;
    }
  }
}
`, 'cfg_labeled_break.ts');
      expect(cfg).toBeDefined();

      const breakEdges = cfg!.edges.filter(e => e.label === 'break');
      expect(breakEdges).toHaveLength(1);

      // The break should target the outer loop's merge
      const loopNodes = cfg!.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes).toHaveLength(2);

      const outerLoop = loopNodes[0]; // first loop is outer
      const outerMerge = cfg!.nodes.find(n =>
        n.kind === 'merge' &&
        cfg!.edges.some(e => e.from === outerLoop.id && e.to === n.id && e.label === 'false')
      );
      expect(outerMerge).toBeDefined();
      expect(breakEdges[0].to).toBe(outerMerge!.id);
    });
  });

  // ==========================================================================
  // try/catch/finally
  // ==========================================================================

  describe('try/catch/finally', () => {
    it('try/catch/finally — both paths reachable, finally on all paths', () => {
      const cfg = cfgGet(`
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

      // Exception edge should exist
      const exceptionEdges = cfg!.edges.filter(e => e.label === 'exception');
      expect(exceptionEdges.length).toBeGreaterThanOrEqual(1);

      // Finally edge should exist
      const finallyEdges = cfg!.edges.filter(e => e.label === 'finally');
      expect(finallyEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('try without catch (only finally)', () => {
      const cfg = cfgGet(`
function tryFinally() {
  try {
    doSomething();
  } finally {
    cleanup();
  }
}
`, 'cfg_try_finally.ts');
      expect(cfg).toBeDefined();

      // Finally edges should exist
      const finallyEdges = cfg!.edges.filter(e => e.label === 'finally');
      expect(finallyEdges.length).toBeGreaterThanOrEqual(1);

      // No exception edges (no catch)
      const exceptionEdges = cfg!.edges.filter(e => e.label === 'exception');
      expect(exceptionEdges).toHaveLength(0);
    });

    it('try without finally — try body and catch merge', () => {
      const cfg = cfgGet(`
function tryCatchNoFinally() {
  try {
    doSomething();
  } catch (e) {
    handleError(e);
  }
}
`, 'cfg_try_catch_no_finally.ts');
      expect(cfg).toBeDefined();

      // Exception edge should exist
      const exceptionEdges = cfg!.edges.filter(e => e.label === 'exception');
      expect(exceptionEdges.length).toBeGreaterThanOrEqual(1);

      // No finally edges
      const finallyEdges = cfg!.edges.filter(e => e.label === 'finally');
      expect(finallyEdges).toHaveLength(0);
    });

    it('cyclomatic complexity: try/catch = 2', () => {
      const { index, file } = cfgsGet(`
function tryCatchCC() {
  try {
    riskyOperation();
  } catch (e) {
    handleError(e);
  }
}
`, 'cfg_cc_try_catch.ts');

      const symbols = index.symbolsInFileGet(file);
      const fn = symbols.find(s => s.name === 'tryCatchCC' && s.kind === 'function');
      expect(fn).toBeDefined();

      const cc = index.cyclomaticComplexityGet(fn!.id);
      // try/catch adds one alternative path → V(G) = 2
      expect(cc).toBe(2);
    });
  });

  // ==========================================================================
  // Ternary Expressions
  // ==========================================================================

  describe('ternary expressions', () => {
    it('simple ternary in variable declaration — branch + merge with true/false edges', () => {
      const cfg = cfgGet(`
function ternarySimple(a: boolean) {
  const x = a ? 1 : 2;
}
`, 'cfg_ternary_simple.ts');
      expect(cfg).toBeDefined();

      const branches = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branches).toHaveLength(1);
      expect(branches[0].label).toBe('ternary');

      const merges = cfg!.nodes.filter(n => n.kind === 'merge');
      expect(merges).toHaveLength(1);
      expect(merges[0].label).toBe('ternary-merge');

      const trueEdges = cfg!.edges.filter(e => e.label === 'true');
      expect(trueEdges).toHaveLength(1);
      expect(trueEdges[0].from).toBe(branches[0].id);

      const falseEdges = cfg!.edges.filter(e => e.label === 'false');
      expect(falseEdges).toHaveLength(1);
      expect(falseEdges[0].from).toBe(branches[0].id);

      // Both paths merge
      const mergeIncoming = cfg!.edges.filter(e => e.to === merges[0].id);
      expect(mergeIncoming).toHaveLength(2);
    });

    it('ternary in expression statement — branch + merge', () => {
      const cfg = cfgGet(`
function ternaryExpr(a: boolean) {
  a ? console.log('yes') : console.log('no');
}
`, 'cfg_ternary_expr.ts');
      expect(cfg).toBeDefined();

      const branches = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branches).toHaveLength(1);
      expect(branches[0].label).toBe('ternary');

      const trueEdges = cfg!.edges.filter(e => e.label === 'true');
      expect(trueEdges).toHaveLength(1);

      const falseEdges = cfg!.edges.filter(e => e.label === 'false');
      expect(falseEdges).toHaveLength(1);

      const merges = cfg!.nodes.filter(n => n.kind === 'merge');
      expect(merges).toHaveLength(1);
    });

    it('nested ternary — 2 branch nodes with nested merge', () => {
      const cfg = cfgGet(`
function ternaryNested(a: boolean, b: boolean) {
  const x = a ? (b ? 1 : 2) : 3;
}
`, 'cfg_ternary_nested.ts');
      expect(cfg).toBeDefined();

      // Two ternary branch nodes: outer (a) and inner (b)
      const branches = cfg!.nodes.filter(n => n.kind === 'branch');
      expect(branches).toHaveLength(2);
      expect(branches.every(b => b.label === 'ternary')).toBe(true);

      // Two merge nodes: inner ternary merge and outer ternary merge
      const merges = cfg!.nodes.filter(n => n.kind === 'merge');
      expect(merges).toHaveLength(2);

      // 2 true + 2 false edges (one pair per ternary)
      const trueEdges = cfg!.edges.filter(e => e.label === 'true');
      expect(trueEdges).toHaveLength(2);

      const falseEdges = cfg!.edges.filter(e => e.label === 'false');
      expect(falseEdges).toHaveLength(2);
    });

    it('cyclomatic complexity: single ternary = 2', () => {
      const { index, file } = cfgsGet(`
function ternaryCC(a: boolean) {
  const x = a ? 1 : 2;
}
`, 'cfg_cc_ternary.ts');

      const symbols = index.symbolsInFileGet(file);
      const fn = symbols.find(s => s.name === 'ternaryCC' && s.kind === 'function');
      expect(fn).toBeDefined();

      const cc = index.cyclomaticComplexityGet(fn!.id);
      // One decision point (ternary) → V(G) = 2
      expect(cc).toBe(2);
    });

    it('cyclomatic complexity: ternary + if = 3', () => {
      const { index, file } = cfgsGet(`
function ternaryPlusIf(a: boolean, b: boolean) {
  if (a) {
    console.log('a');
  }
  const x = b ? 1 : 2;
}
`, 'cfg_cc_ternary_if.ts');

      const symbols = index.symbolsInFileGet(file);
      const fn = symbols.find(s => s.name === 'ternaryPlusIf' && s.kind === 'function');
      expect(fn).toBeDefined();

      const cc = index.cyclomaticComplexityGet(fn!.id);
      // Two decision points (if + ternary) → V(G) = 3
      expect(cc).toBe(3);
    });
  });
});

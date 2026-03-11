/**
 * @packageDocumentation
 * Control Flow Graph (CFG) construction from Tree-sitter ASTs.
 *
 * Walks function body ASTs to build per-function control flow graphs.
 * Each graph has exactly one entry node and one exit node.
 * Nodes represent control flow points; edges represent possible transitions.
 *
 * Supported patterns:
 * - Sequential statements (linear flow)
 * - if/else branching (branch + merge nodes)
 * - Ternary expressions (branch + merge, nested supported)
 * - while, for, do...while, for...in, for...of loops (loop node + back-edge)
 * - return / throw (edge to exit node)
 * - break / continue (edge to loop exit / loop header, with label support)
 * - switch/case/default (multi-branch with fallthrough)
 * - try/catch/finally (conservative catch-always-reachable model)
 */

import type Parser from 'web-tree-sitter';
import type {
  ScopeRecord,
  FlowNodeId,
  FlowNode,
  FlowEdge,
  FlowGraph,
  FlowNodeKind,
  ByteRange,
} from '../../index/indexTypes';

// ============================================================================
// ID Generation
// ============================================================================

let nodeCounter = 0;

function cfgNodeCounterReset(): void {
  nodeCounter = 0;
}

function flowNodeIdCreate(scopeId: string, kind: FlowNodeKind): FlowNodeId {
  return `${scopeId}:${kind}:${nodeCounter++}`;
}

// ============================================================================
// Loop Context (for break/continue targeting)
// ============================================================================

/**
 * Context threaded through statement processing for break/continue resolution.
 * Each loop (and switch for break) pushes a new context. Labeled break/continue
 * walk up the parent chain to find the matching label.
 */
type LoopContext = {
  /** Where `break` jumps to (loop merge / switch merge) */
  breakTarget: FlowNodeId;
  /** Where `continue` jumps to (loop header / for-increment). undefined for switch. */
  continueTarget?: FlowNodeId;
  /** Label for labeled loops: `outer: for (...)` */
  label?: string;
  /** Parent context for label chain walking */
  parent?: LoopContext;
};

/**
 * Find the LoopContext matching a label, or return the innermost context.
 */
function loopContextFind(ctx: LoopContext | undefined, label?: string): LoopContext | undefined {
  if (!ctx) return undefined;
  if (!label) return ctx;
  let current: LoopContext | undefined = ctx;
  while (current) {
    if (current.label === label) return current;
    current = current.parent;
  }
  return ctx; // fallback to innermost
}

// ============================================================================
// Graph Builder
// ============================================================================

type CfgBuilder = {
  scopeId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  entryId: FlowNodeId;
  exitId: FlowNodeId;
};

function cfgBuilderCreate(scopeId: string): CfgBuilder {
  const entryNode: FlowNode = {
    id: flowNodeIdCreate(scopeId, 'entry'),
    kind: 'entry',
    label: 'entry',
  };
  const exitNode: FlowNode = {
    id: flowNodeIdCreate(scopeId, 'exit'),
    kind: 'exit',
    label: 'exit',
  };
  return {
    scopeId,
    nodes: [entryNode, exitNode],
    edges: [],
    entryId: entryNode.id,
    exitId: exitNode.id,
  };
}

function nodeAdd(
  builder: CfgBuilder,
  kind: FlowNodeKind,
  byteRange?: ByteRange,
  label?: string
): FlowNode {
  const node: FlowNode = {
    id: flowNodeIdCreate(builder.scopeId, kind),
    kind,
    byteRange,
    label,
  };
  builder.nodes.push(node);
  return node;
}

function edgeAdd(
  builder: CfgBuilder,
  from: FlowNodeId,
  to: FlowNodeId,
  label?: FlowEdge['label']
): void {
  builder.edges.push({ from, to, label });
}

function byteRangeFromNode(node: Parser.SyntaxNode): ByteRange {
  return { start: node.startIndex, end: node.endIndex };
}

// ============================================================================
// Statement Processing
// ============================================================================

function statementsProcess(
  builder: CfgBuilder,
  stmts: Parser.SyntaxNode[],
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  loopCtx?: LoopContext
): FlowNodeId[] {
  let current = [...predecessors];
  for (const stmt of stmts) {
    if (current.length === 0) break;
    current = statementProcess(builder, stmt, current, exitId, loopCtx);
  }
  return current;
}

function statementProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  loopCtx?: LoopContext
): FlowNodeId[] {
  switch (stmt.type) {
    case 'if_statement':
      return ifProcess(builder, stmt, predecessors, exitId, loopCtx);
    case 'while_statement':
      return whileProcess(builder, stmt, predecessors, exitId, loopCtx);
    case 'for_statement':
      return forProcess(builder, stmt, predecessors, exitId, loopCtx);
    case 'do_statement':
      return doWhileProcess(builder, stmt, predecessors, exitId, loopCtx);
    case 'for_in_statement':
      return forInOfProcess(builder, stmt, predecessors, exitId, loopCtx);
    case 'switch_statement':
      return switchProcess(builder, stmt, predecessors, exitId, loopCtx);
    case 'try_statement':
      return tryProcess(builder, stmt, predecessors, exitId, loopCtx);
    case 'return_statement':
      return terminatorProcess(builder, stmt, predecessors, exitId, 'return');
    case 'throw_statement':
    case 'raise_statement':
      return terminatorProcess(builder, stmt, predecessors, exitId, 'throw');
    case 'break_statement':
      return breakProcess(builder, stmt, predecessors, loopCtx);
    case 'continue_statement':
      return continueProcess(builder, stmt, predecessors, loopCtx);
    case 'labeled_statement':
      return labeledStatementProcess(builder, stmt, predecessors, exitId, loopCtx);
    case 'statement_block':
    case 'block':
      return statementsProcess(builder, namedChildrenGet(stmt), predecessors, exitId, loopCtx);
    default: {
      const ternary = ternaryExpressionFind(stmt);
      if (ternary) {
        return ternaryProcess(builder, stmt, ternary, predecessors);
      }
      return simpleStatementProcess(builder, stmt, predecessors);
    }
  }
}

function simpleStatementProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[]
): FlowNodeId[] {
  const node = nodeAdd(builder, 'statement', byteRangeFromNode(stmt), stmt.type);
  for (const pred of predecessors) {
    edgeAdd(builder, pred, node.id, 'unconditional');
  }
  return [node.id];
}

// ============================================================================
// Ternary Expression
// ============================================================================

/**
 * Recursively search a syntax node's subtree for a `ternary_expression`.
 * Returns the first (outermost) ternary found via depth-first search, or null.
 */
function ternaryExpressionFind(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  if (node.type === 'ternary_expression') return node;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) {
      const found = ternaryExpressionFind(child);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Process a statement containing a ternary expression as a branch point.
 * Models `condition ? consequence : alternative` identically to if/else:
 * branch(condition) → true-path(consequence) / false-path(alternative) → merge.
 *
 * Nested ternaries in consequence or alternative are handled recursively:
 * each nested ternary produces its own branch/merge subgraph.
 *
 * @param incomingEdgeLabel - When called from a parent ternary branch, the
 *   edge label ('true'/'false') to use for the edge from predecessors into
 *   this ternary's branch node. Top-level calls use 'unconditional'.
 */
function ternaryProcess(
  builder: CfgBuilder,
  _stmt: Parser.SyntaxNode,
  ternary: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  incomingEdgeLabel?: 'true' | 'false'
): FlowNodeId[] {
  const condition = ternary.childForFieldName('condition');
  const consequence = ternary.childForFieldName('consequence');
  const alternative = ternary.childForFieldName('alternative');

  // Branch node on the condition
  const branch = nodeAdd(
    builder, 'branch',
    condition ? byteRangeFromNode(condition) : byteRangeFromNode(ternary),
    'ternary'
  );
  for (const pred of predecessors) {
    edgeAdd(builder, pred, branch.id, incomingEdgeLabel ?? 'unconditional');
  }

  // True path — consequence expression (may contain nested ternary)
  const trueLive = ternaryBranchProcess(builder, consequence, branch.id, 'true');

  // False path — alternative expression (may contain nested ternary)
  const falseLive = ternaryBranchProcess(builder, alternative, branch.id, 'false');

  // Merge
  const merge = nodeAdd(builder, 'merge', undefined, 'ternary-merge');
  for (const id of trueLive) {
    edgeAdd(builder, id, merge.id, 'unconditional');
  }
  for (const id of falseLive) {
    edgeAdd(builder, id, merge.id, 'unconditional');
  }
  return [merge.id];
}

/**
 * Process one branch (true or false) of a ternary expression.
 * If the branch expression itself contains a nested ternary, recurse
 * with the correct edge label so the parent→child edge is labeled properly.
 * Otherwise, emit a simple statement node for the expression.
 */
function ternaryBranchProcess(
  builder: CfgBuilder,
  exprNode: Parser.SyntaxNode | null,
  branchId: FlowNodeId,
  edgeLabel: 'true' | 'false'
): FlowNodeId[] {
  if (!exprNode) {
    // Shouldn't happen for valid ternaries, but handle gracefully
    return [branchId];
  }

  // Check if this branch expression is itself a ternary
  const nested = ternaryExpressionFind(exprNode);
  if (nested) {
    // Recurse: pass edgeLabel so the outer branch → inner branch edge
    // is labeled 'true'/'false' instead of 'unconditional'
    return ternaryProcess(builder, exprNode, nested, [branchId], edgeLabel);
  }

  // Leaf expression — emit a statement node
  const node = nodeAdd(builder, 'statement', byteRangeFromNode(exprNode), `ternary-${edgeLabel}`);
  edgeAdd(builder, branchId, node.id, edgeLabel);
  return [node.id];
}

function terminatorProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  kind: 'return' | 'throw'
): FlowNodeId[] {
  const node = nodeAdd(builder, kind, byteRangeFromNode(stmt), kind);
  for (const pred of predecessors) {
    edgeAdd(builder, pred, node.id, 'unconditional');
  }
  edgeAdd(builder, node.id, exitId, 'unconditional');
  return [];
}

// ============================================================================
// break / continue
// ============================================================================

function breakProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  loopCtx?: LoopContext
): FlowNodeId[] {
  const node = nodeAdd(builder, 'statement', byteRangeFromNode(stmt), 'break');

  // Check for labeled break
  const labelNode = stmt.childForFieldName('label');
  const labelText = labelNode ? labelNode.text : undefined;
  const ctx = loopContextFind(loopCtx, labelText);

  for (const pred of predecessors) {
    edgeAdd(builder, pred, node.id, 'unconditional');
  }

  if (ctx) {
    edgeAdd(builder, node.id, ctx.breakTarget, 'break');
  }
  // Even if no context, flow terminates (break without enclosing loop is a syntax error)
  return [];
}

function continueProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  loopCtx?: LoopContext
): FlowNodeId[] {
  const node = nodeAdd(builder, 'statement', byteRangeFromNode(stmt), 'continue');

  const labelNode = stmt.childForFieldName('label');
  const labelText = labelNode ? labelNode.text : undefined;
  const ctx = loopContextFind(loopCtx, labelText);

  for (const pred of predecessors) {
    edgeAdd(builder, pred, node.id, 'unconditional');
  }

  if (ctx && ctx.continueTarget) {
    edgeAdd(builder, node.id, ctx.continueTarget, 'continue');
  }
  return [];
}

// ============================================================================
// labeled statement
// ============================================================================

/**
 * Process a labeled statement. Extracts the label text and delegates
 * to statementProcess for the inner statement. The label is picked up
 * by loop handlers via `labelForStatementGet`.
 */
function labeledStatementProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  loopCtx?: LoopContext
): FlowNodeId[] {
  // Find the body statement (the child that isn't the label)
  const bodyChild = stmt.childForFieldName('body');
  if (bodyChild) {
    return statementProcess(builder, bodyChild, predecessors, exitId, loopCtx);
  }
  // Fallback: process named children that aren't the label identifier
  for (let i = 0; i < stmt.namedChildCount; i++) {
    const child = stmt.namedChild(i);
    if (child && child.type !== 'statement_identifier' && child.type !== 'identifier') {
      return statementProcess(builder, child, predecessors, exitId, loopCtx);
    }
  }
  return simpleStatementProcess(builder, stmt, predecessors);
}

// ============================================================================
// if/else
// ============================================================================

function ifProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  loopCtx?: LoopContext
): FlowNodeId[] {
  const conditionNode = stmt.childForFieldName('condition');
  const consequence = stmt.childForFieldName('consequence');
  const alternative = stmt.childForFieldName('alternative');

  const branch = nodeAdd(
    builder, 'branch',
    conditionNode ? byteRangeFromNode(conditionNode) : byteRangeFromNode(stmt),
    'if'
  );
  for (const pred of predecessors) {
    edgeAdd(builder, pred, branch.id, 'unconditional');
  }

  const trueLive = branchPathProcess(builder, consequence, branch.id, exitId, 'true', loopCtx);
  const falseLive = alternative
    ? branchPathProcess(builder, alternative, branch.id, exitId, 'false', loopCtx)
    : [branch.id];

  if (trueLive.length === 0 && falseLive.length === 0) return [];

  const merge = nodeAdd(builder, 'merge', undefined, 'if-merge');
  for (const id of trueLive) {
    edgeAdd(builder, id, merge.id, 'unconditional');
  }
  if (!alternative) {
    edgeAdd(builder, branch.id, merge.id, 'false');
  } else {
    for (const id of falseLive) {
      edgeAdd(builder, id, merge.id, 'unconditional');
    }
  }
  return [merge.id];
}

function branchPathProcess(
  builder: CfgBuilder,
  bodyNode: Parser.SyntaxNode | null,
  branchId: FlowNodeId,
  exitId: FlowNodeId,
  edgeLabel: 'true' | 'false',
  loopCtx?: LoopContext
): FlowNodeId[] {
  if (!bodyNode) return [];

  const stmts = bodyNode.type === 'statement_block'
    ? namedChildrenGet(bodyNode)
    : bodyNode.type === 'else_clause'
      ? namedChildrenGet(bodyNode)
      : [bodyNode];

  if (stmts.length === 0) return [branchId];

  const edgeCountBefore = builder.edges.length;
  const live = statementsProcess(builder, stmts, [branchId], exitId, loopCtx);

  for (let i = edgeCountBefore; i < builder.edges.length; i++) {
    if (builder.edges[i].from === branchId) {
      builder.edges[i].label = edgeLabel;
      break;
    }
  }
  return live;
}

// ============================================================================
// while
// ============================================================================

function whileProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  parentCtx?: LoopContext
): FlowNodeId[] {
  const conditionNode = stmt.childForFieldName('condition');
  const body = stmt.childForFieldName('body');

  const loop = nodeAdd(
    builder, 'loop',
    conditionNode ? byteRangeFromNode(conditionNode) : byteRangeFromNode(stmt),
    'while'
  );
  for (const pred of predecessors) {
    edgeAdd(builder, pred, loop.id, 'unconditional');
  }

  const merge = nodeAdd(builder, 'merge', undefined, 'while-exit');

  // Check for label on the parent labeled_statement
  const label = labelForStatementGet(stmt);

  const loopCtx: LoopContext = {
    breakTarget: merge.id,
    continueTarget: loop.id,
    label,
    parent: parentCtx,
  };

  if (body) {
    const bodyStmts = body.type === 'statement_block' ? namedChildrenGet(body) : [body];
    if (bodyStmts.length > 0) {
      const edgeCountBefore = builder.edges.length;
      const bodyLive = statementsProcess(builder, bodyStmts, [loop.id], exitId, loopCtx);
      for (let i = edgeCountBefore; i < builder.edges.length; i++) {
        if (builder.edges[i].from === loop.id) {
          builder.edges[i].label = 'true';
          break;
        }
      }
      for (const live of bodyLive) {
        edgeAdd(builder, live, loop.id, 'loop-back');
      }
    } else {
      edgeAdd(builder, loop.id, loop.id, 'true');
    }
  }

  edgeAdd(builder, loop.id, merge.id, 'false');
  return [merge.id];
}

// ============================================================================
// for
// ============================================================================

function forProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  parentCtx?: LoopContext
): FlowNodeId[] {
  // Python for: `for left in right: body` — delegate to iterator-style handler
  const rightNode = stmt.childForFieldName('right');
  if (rightNode) {
    return pythonForProcess(builder, stmt, rightNode, predecessors, exitId, parentCtx);
  }

  const initializer = stmt.childForFieldName('initializer');
  const condition = stmt.childForFieldName('condition');
  const increment = stmt.childForFieldName('increment');
  const body = stmt.childForFieldName('body');

  let current = [...predecessors];

  if (initializer) {
    const initNode = nodeAdd(builder, 'statement', byteRangeFromNode(initializer), 'for-init');
    for (const pred of current) {
      edgeAdd(builder, pred, initNode.id, 'unconditional');
    }
    current = [initNode.id];
  }

  const loop = nodeAdd(
    builder, 'loop',
    condition ? byteRangeFromNode(condition) : byteRangeFromNode(stmt),
    'for'
  );
  for (const pred of current) {
    edgeAdd(builder, pred, loop.id, 'unconditional');
  }

  const merge = nodeAdd(builder, 'merge', undefined, 'for-exit');
  const label = labelForStatementGet(stmt);

  // For `continue` in a `for` loop: jump to increment (or loop header if no increment)
  let continueTarget = loop.id;
  let incNode: FlowNode | undefined;
  if (increment) {
    incNode = nodeAdd(builder, 'statement', byteRangeFromNode(increment), 'for-increment');
    continueTarget = incNode.id;
  }

  const loopCtx: LoopContext = {
    breakTarget: merge.id,
    continueTarget,
    label,
    parent: parentCtx,
  };

  if (body) {
    const bodyStmts = body.type === 'statement_block' ? namedChildrenGet(body) : [body];
    if (bodyStmts.length > 0) {
      const edgeCountBefore = builder.edges.length;
      let backEdgeSources = statementsProcess(builder, bodyStmts, [loop.id], exitId, loopCtx);
      for (let i = edgeCountBefore; i < builder.edges.length; i++) {
        if (builder.edges[i].from === loop.id) {
          builder.edges[i].label = 'true';
          break;
        }
      }

      if (incNode && backEdgeSources.length > 0) {
        for (const live of backEdgeSources) {
          edgeAdd(builder, live, incNode.id, 'unconditional');
        }
        backEdgeSources = [incNode.id];
      }

      for (const src of backEdgeSources) {
        edgeAdd(builder, src, loop.id, 'loop-back');
      }
    } else {
      if (incNode) {
        edgeAdd(builder, loop.id, incNode.id, 'true');
        edgeAdd(builder, incNode.id, loop.id, 'loop-back');
      } else {
        edgeAdd(builder, loop.id, loop.id, 'true');
      }
    }
  }

  // Wire increment for `continue` edges that jumped directly to incNode
  // (they need a back-edge from incNode to loop if incNode wasn't already wired)
  // This is already handled above since incNode → loop back-edge is created when body is live.
  // For the case where body has `continue` but no other live path, the increment node
  // may already have incoming edges from continue but no outgoing back-edge yet.
  // Check if incNode has a back-edge to loop already:
  if (incNode) {
    const hasBackEdge = builder.edges.some(e => e.from === incNode!.id && e.to === loop.id);
    if (!hasBackEdge) {
      edgeAdd(builder, incNode.id, loop.id, 'loop-back');
    }
  }

  edgeAdd(builder, loop.id, merge.id, 'false');
  return [merge.id];
}

/**
 * Handle Python's `for left in right: body` — semantically an iterator loop
 * like JS for-in/for-of. Uses the iterable (`right`) as the loop node range.
 */
function pythonForProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  rightNode: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  parentCtx?: LoopContext
): FlowNodeId[] {
  const body = stmt.childForFieldName('body');

  const loop = nodeAdd(builder, 'loop', byteRangeFromNode(rightNode), 'for');
  for (const pred of predecessors) {
    edgeAdd(builder, pred, loop.id, 'unconditional');
  }

  const merge = nodeAdd(builder, 'merge', undefined, 'for-exit');
  const label = labelForStatementGet(stmt);

  const loopCtx: LoopContext = {
    breakTarget: merge.id,
    continueTarget: loop.id,
    label,
    parent: parentCtx,
  };

  if (body) {
    const bodyStmts = body.type === 'statement_block' || body.type === 'block'
      ? namedChildrenGet(body)
      : [body];
    if (bodyStmts.length > 0) {
      const edgeCountBefore = builder.edges.length;
      const bodyLive = statementsProcess(builder, bodyStmts, [loop.id], exitId, loopCtx);
      for (let i = edgeCountBefore; i < builder.edges.length; i++) {
        if (builder.edges[i].from === loop.id) {
          builder.edges[i].label = 'true';
          break;
        }
      }
      for (const live of bodyLive) {
        edgeAdd(builder, live, loop.id, 'loop-back');
      }
    } else {
      edgeAdd(builder, loop.id, loop.id, 'true');
    }
  }

  edgeAdd(builder, loop.id, merge.id, 'false');
  return [merge.id];
}

// ============================================================================
// do...while
// ============================================================================

function doWhileProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  parentCtx?: LoopContext
): FlowNodeId[] {
  const body = stmt.childForFieldName('body');
  const conditionNode = stmt.childForFieldName('condition');

  const bodyEntry = nodeAdd(builder, 'statement', byteRangeFromNode(stmt), 'do-body-entry');
  for (const pred of predecessors) {
    edgeAdd(builder, pred, bodyEntry.id, 'unconditional');
  }

  const loop = nodeAdd(
    builder, 'loop',
    conditionNode ? byteRangeFromNode(conditionNode) : byteRangeFromNode(stmt),
    'do-while'
  );

  const merge = nodeAdd(builder, 'merge', undefined, 'do-while-exit');
  const label = labelForStatementGet(stmt);

  const loopCtx: LoopContext = {
    breakTarget: merge.id,
    continueTarget: loop.id, // continue goes to condition check
    label,
    parent: parentCtx,
  };

  let bodyLive: FlowNodeId[] = [bodyEntry.id];
  if (body) {
    const bodyStmts = body.type === 'statement_block' ? namedChildrenGet(body) : [body];
    bodyLive = statementsProcess(builder, bodyStmts, [bodyEntry.id], exitId, loopCtx);
  }

  for (const live of bodyLive) {
    edgeAdd(builder, live, loop.id, 'unconditional');
  }

  edgeAdd(builder, loop.id, bodyEntry.id, 'true');
  edgeAdd(builder, loop.id, merge.id, 'false');
  return [merge.id];
}

// ============================================================================
// for...in / for...of
// ============================================================================

function forInOfProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  parentCtx?: LoopContext
): FlowNodeId[] {
  const body = stmt.childForFieldName('body');

  // The loop node represents the iterator check (has next element?)
  const loop = nodeAdd(builder, 'loop', byteRangeFromNode(stmt), stmt.type === 'for_in_statement' ? 'for-in' : 'for-of');
  for (const pred of predecessors) {
    edgeAdd(builder, pred, loop.id, 'unconditional');
  }

  const merge = nodeAdd(builder, 'merge', undefined, `${stmt.type}-exit`);
  const label = labelForStatementGet(stmt);

  const loopCtx: LoopContext = {
    breakTarget: merge.id,
    continueTarget: loop.id,
    label,
    parent: parentCtx,
  };

  if (body) {
    const bodyStmts = body.type === 'statement_block' ? namedChildrenGet(body) : [body];
    if (bodyStmts.length > 0) {
      const edgeCountBefore = builder.edges.length;
      const bodyLive = statementsProcess(builder, bodyStmts, [loop.id], exitId, loopCtx);
      for (let i = edgeCountBefore; i < builder.edges.length; i++) {
        if (builder.edges[i].from === loop.id) {
          builder.edges[i].label = 'true';
          break;
        }
      }
      for (const live of bodyLive) {
        edgeAdd(builder, live, loop.id, 'loop-back');
      }
    } else {
      edgeAdd(builder, loop.id, loop.id, 'true');
    }
  }

  edgeAdd(builder, loop.id, merge.id, 'false');
  return [merge.id];
}

// ============================================================================
// switch/case
// ============================================================================

function switchProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  parentCtx?: LoopContext
): FlowNodeId[] {
  const valueNode = stmt.childForFieldName('value');
  const bodyNode = stmt.childForFieldName('body');

  // Branch node for the switch discriminant
  const branch = nodeAdd(
    builder, 'branch',
    valueNode ? byteRangeFromNode(valueNode) : byteRangeFromNode(stmt),
    'switch'
  );
  for (const pred of predecessors) {
    edgeAdd(builder, pred, branch.id, 'unconditional');
  }

  const merge = nodeAdd(builder, 'merge', undefined, 'switch-exit');

  // Switch acts as break target (break inside switch goes to merge)
  // but NOT as continue target (continue inside switch goes to enclosing loop)
  const switchCtx: LoopContext = {
    breakTarget: merge.id,
    continueTarget: parentCtx?.continueTarget,
    label: undefined,
    parent: parentCtx,
  };

  if (!bodyNode) {
    edgeAdd(builder, branch.id, merge.id, 'unconditional');
    return [merge.id];
  }

  const cases = namedChildrenGet(bodyNode);
  let hasDefault = false;
  let prevCaseLive: FlowNodeId[] = []; // for fallthrough

  for (const caseNode of cases) {
    const isDefault = caseNode.type === 'switch_default';
    if (isDefault) hasDefault = true;

    const caseLabel: FlowEdge['label'] = isDefault ? 'default' : 'case';

    // Get the statements inside this case.
    // For switch_case, the first named child is the case value — skip it.
    // For switch_default, all named children are statements.
    const caseValueNode = isDefault ? null : caseNode.childForFieldName('value');
    const caseStmts: Parser.SyntaxNode[] = [];
    for (let i = 0; i < caseNode.namedChildCount; i++) {
      const child = caseNode.namedChild(i);
      if (!child || child.type === 'comment') continue;
      if (caseValueNode && child.id === caseValueNode.id) continue;
      caseStmts.push(child);
    }

    // Predecessors for this case: branch (direct entry) + fallthrough from previous case
    const casePredecessors = [...prevCaseLive];

    if (caseStmts.length === 0) {
      // Empty case — branch enters, falls through to next
      const connector = nodeAdd(builder, 'statement', byteRangeFromNode(caseNode), `empty-${caseLabel}`);
      edgeAdd(builder, branch.id, connector.id, caseLabel);
      for (const pred of casePredecessors) {
        edgeAdd(builder, pred, connector.id, 'unconditional');
      }
      prevCaseLive = [connector.id];
    } else {
      // Branch edge to first statement of this case
      const edgeCountBefore = builder.edges.length;
      const allPreds = [branch.id, ...casePredecessors];
      const caseLive = statementsProcess(builder, caseStmts, allPreds, exitId, switchCtx);

      // Relabel the first edge from branch.id as case/default
      for (let i = edgeCountBefore; i < builder.edges.length; i++) {
        if (builder.edges[i].from === branch.id) {
          builder.edges[i].label = caseLabel;
          break;
        }
      }

      prevCaseLive = caseLive;
    }
  }

  // If no default case, branch can fall through directly to merge
  if (!hasDefault) {
    edgeAdd(builder, branch.id, merge.id, 'default');
  }

  // Wire remaining live ends (from last case fallthrough) to merge
  for (const id of prevCaseLive) {
    edgeAdd(builder, id, merge.id, 'unconditional');
  }

  return [merge.id];
}

// ============================================================================
// try/catch/finally
// ============================================================================

/**
 * Conservative model: catch is always reachable from the try entry.
 * Both try body and catch body flow through finally (if present) before merging.
 *
 *   predecessors → try-body → [finally] → merge
 *                → catch-body → [finally] → merge
 */
function tryProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId,
  loopCtx?: LoopContext
): FlowNodeId[] {
  const tryBody = stmt.childForFieldName('body');
  const handler = stmt.childForFieldName('handler');
  const finalizer = stmt.childForFieldName('finalizer');

  // Process try body
  let tryLive: FlowNodeId[] = [...predecessors];
  if (tryBody) {
    const tryStmts = tryBody.type === 'statement_block' ? namedChildrenGet(tryBody) : [tryBody];
    tryLive = statementsProcess(builder, tryStmts, predecessors, exitId, loopCtx);
  }

  // Process catch — conservative model: catch is always reachable from try entry
  let catchLive: FlowNodeId[] = [];
  if (handler) {
    const catchBody = handler.childForFieldName('body');
    if (catchBody) {
      // Exception edge: predecessors → catch body
      const exceptionEntry = nodeAdd(builder, 'statement', byteRangeFromNode(handler), 'catch');
      for (const pred of predecessors) {
        edgeAdd(builder, pred, exceptionEntry.id, 'exception');
      }
      const catchStmts = catchBody.type === 'statement_block' ? namedChildrenGet(catchBody) : [catchBody];
      catchLive = statementsProcess(builder, catchStmts, [exceptionEntry.id], exitId, loopCtx);
    }
  }

  // Combine live paths from try and catch
  let allLive = [...tryLive, ...catchLive];

  // Process finally — mandatory block on all paths
  if (finalizer) {
    const finallyBody = finalizer.type === 'finally_clause'
      ? finalizer.childForFieldName('body')
      : finalizer;
    if (finallyBody && allLive.length > 0) {
      const finallyStmts = finallyBody.type === 'statement_block' ? namedChildrenGet(finallyBody) : [finallyBody];
      if (finallyStmts.length > 0) {
        // Create a single finally entry that all paths merge into
        const finallyEntry = nodeAdd(builder, 'statement', byteRangeFromNode(finalizer), 'finally');
        for (const live of allLive) {
          edgeAdd(builder, live, finallyEntry.id, 'finally');
        }
        allLive = statementsProcess(builder, finallyStmts, [finallyEntry.id], exitId, loopCtx);
      }
    }
  }

  return allLive;
}

// ============================================================================
// Helpers
// ============================================================================

function namedChildrenGet(block: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const children: Parser.SyntaxNode[] = [];
  for (let i = 0; i < block.namedChildCount; i++) {
    const child = block.namedChild(i);
    if (child && child.type !== 'comment') {
      children.push(child);
    }
  }
  return children;
}

/**
 * Check if a statement is wrapped in a labeled_statement and return the label.
 * Tree-sitter structure: `labeled_statement` > `label: (identifier)` + child statement.
 */
function labelForStatementGet(stmt: Parser.SyntaxNode): string | undefined {
  const parent = stmt.parent;
  if (parent && parent.type === 'labeled_statement') {
    const labelNode = parent.childForFieldName('label');
    if (labelNode) return labelNode.text;
  }
  return undefined;
}

// ============================================================================
// Function Node Discovery
// ============================================================================

const FUNCTION_NODE_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'arrow_function',
  'method_definition',
  'function',
  'generator_function',
  'function_definition',
]);

function functionNodesCollect(rootNode: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const results: Parser.SyntaxNode[] = [];
  function walk(node: Parser.SyntaxNode): void {
    if (FUNCTION_NODE_TYPES.has(node.type)) {
      results.push(node);
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) walk(child);
    }
  }
  walk(rootNode);
  return results;
}

function scopeForFunctionFind(
  funcNode: Parser.SyntaxNode,
  scopes: ScopeRecord[]
): ScopeRecord | undefined {
  const body = funcNode.childForFieldName('body');
  if (body) {
    for (const scope of scopes) {
      if (scope.kind === 'function' &&
          scope.byteRange.start === body.startIndex &&
          scope.byteRange.end === body.endIndex) {
        return scope;
      }
    }
  }

  for (const scope of scopes) {
    if (scope.kind === 'function' &&
        scope.byteRange.start === funcNode.startIndex &&
        scope.byteRange.end === funcNode.endIndex) {
      return scope;
    }
  }

  let best: ScopeRecord | undefined;
  let bestSize = Infinity;
  for (const scope of scopes) {
    if (scope.kind === 'function' &&
        scope.byteRange.start <= funcNode.startIndex &&
        scope.byteRange.end >= funcNode.endIndex) {
      const size = scope.byteRange.end - scope.byteRange.start;
      if (size < bestSize) {
        best = scope;
        bestSize = size;
      }
    }
  }
  return best;
}

// ============================================================================
// Public API
// ============================================================================

export function cfgsExtract(
  tree: Parser.Tree,
  _file: string,
  scopes: ScopeRecord[]
): FlowGraph[] {
  cfgNodeCounterReset();

  const functionNodes = functionNodesCollect(tree.rootNode);
  const graphs: FlowGraph[] = [];

  for (const funcNode of functionNodes) {
    const scope = scopeForFunctionFind(funcNode, scopes);
    if (!scope) continue;

    const body = funcNode.childForFieldName('body');
    if (!body) continue;

    const builder = cfgBuilderCreate(scope.id);

    if (body.type === 'statement_block' || body.type === 'block') {
      const stmts = namedChildrenGet(body);
      if (stmts.length === 0) {
        edgeAdd(builder, builder.entryId, builder.exitId, 'unconditional');
      } else {
        const live = statementsProcess(builder, stmts, [builder.entryId], builder.exitId);
        for (const id of live) {
          edgeAdd(builder, id, builder.exitId, 'unconditional');
        }
      }
    } else {
      const exprNode = nodeAdd(builder, 'statement', byteRangeFromNode(body), 'expression-body');
      edgeAdd(builder, builder.entryId, exprNode.id, 'unconditional');
      edgeAdd(builder, exprNode.id, builder.exitId, 'unconditional');
    }

    graphs.push({
      scopeId: scope.id,
      nodes: builder.nodes,
      edges: builder.edges,
    });
  }

  return graphs;
}

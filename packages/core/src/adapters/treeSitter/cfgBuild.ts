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
 * - while, for, do...while loops (loop node + back-edge)
 * - return / throw (edge to exit node)
 *
 * Not yet supported (deferred):
 * - switch/case
 * - break/continue (requires loop target tracking)
 * - try/catch/finally (complex exceptional flow)
 * - for...in / for...of
 * - Labeled statements
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

/**
 * Reset the node counter. Called at the start of each file's extraction
 * for deterministic IDs.
 */
function cfgNodeCounterReset(): void {
  nodeCounter = 0;
}

/**
 * Generate a unique flow node ID scoped to a function.
 */
function flowNodeIdCreate(scopeId: string, kind: FlowNodeKind): FlowNodeId {
  return `${scopeId}:${kind}:${nodeCounter++}`;
}

// ============================================================================
// Graph Builder
// ============================================================================

/**
 * Mutable graph builder used during CFG construction.
 */
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

/**
 * Process a block of statements sequentially.
 * Returns the set of "live" predecessor IDs at the end of the block
 * (empty if all paths terminated via return/throw).
 */
function statementsProcess(
  builder: CfgBuilder,
  stmts: Parser.SyntaxNode[],
  predecessors: FlowNodeId[],
  exitId: FlowNodeId
): FlowNodeId[] {
  let current = [...predecessors];

  for (const stmt of stmts) {
    if (current.length === 0) break; // Dead code
    current = statementProcess(builder, stmt, current, exitId);
  }

  return current;
}

/**
 * Process a single statement. Returns "live" node IDs after this statement.
 */
function statementProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId
): FlowNodeId[] {
  switch (stmt.type) {
    case 'if_statement':
      return ifProcess(builder, stmt, predecessors, exitId);
    case 'while_statement':
      return whileProcess(builder, stmt, predecessors, exitId);
    case 'for_statement':
      return forProcess(builder, stmt, predecessors, exitId);
    case 'do_statement':
      return doWhileProcess(builder, stmt, predecessors, exitId);
    case 'return_statement':
      return terminatorProcess(builder, stmt, predecessors, exitId, 'return');
    case 'throw_statement':
      return terminatorProcess(builder, stmt, predecessors, exitId, 'throw');
    case 'statement_block':
      return statementsProcess(builder, namedChildrenGet(stmt), predecessors, exitId);
    default:
      return simpleStatementProcess(builder, stmt, predecessors);
  }
}

/**
 * Process a simple sequential statement (expression, declaration, etc.).
 */
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

/**
 * Process return/throw — creates a terminator node, edges to exit.
 * Returns empty (no live successors).
 */
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
// Control Flow: if/else
// ============================================================================

/**
 * Process if/else.
 *
 *   predecessors → branch
 *   branch --true--> consequence → merge
 *   branch --false--> alternative → merge  (or directly to merge if no else)
 *
 * The merge node is only added if at least one branch has live successors.
 */
function ifProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId
): FlowNodeId[] {
  const conditionNode = stmt.childForFieldName('condition');
  const consequence = stmt.childForFieldName('consequence');
  const alternative = stmt.childForFieldName('alternative');

  // Branch node
  const branch = nodeAdd(
    builder, 'branch',
    conditionNode ? byteRangeFromNode(conditionNode) : byteRangeFromNode(stmt),
    'if'
  );
  for (const pred of predecessors) {
    edgeAdd(builder, pred, branch.id, 'unconditional');
  }

  // True branch
  const trueLive = branchPathProcess(builder, consequence, branch.id, exitId, 'true');

  // False branch
  const falseLive = alternative
    ? branchPathProcess(builder, alternative, branch.id, exitId, 'false')
    : [branch.id]; // No else — branch is live via false path

  // If both branches terminated (return/throw), no merge needed
  if (trueLive.length === 0 && falseLive.length === 0) return [];

  // Add merge node and wire live ends
  const merge = nodeAdd(builder, 'merge', undefined, 'if-merge');

  for (const id of trueLive) {
    edgeAdd(builder, id, merge.id, 'unconditional');
  }

  if (!alternative) {
    // No else: false edge goes directly from branch to merge
    edgeAdd(builder, branch.id, merge.id, 'false');
  } else {
    for (const id of falseLive) {
      edgeAdd(builder, id, merge.id, 'unconditional');
    }
  }

  return [merge.id];
}

/**
 * Process one branch of an if/else.
 * Uses edge-count tracking to relabel the first edge from branchId as true/false,
 * while all body statements are dispatched through `statementProcess`.
 */
function branchPathProcess(
  builder: CfgBuilder,
  bodyNode: Parser.SyntaxNode | null,
  branchId: FlowNodeId,
  exitId: FlowNodeId,
  edgeLabel: 'true' | 'false'
): FlowNodeId[] {
  if (!bodyNode) return [];

  const stmts = bodyNode.type === 'statement_block'
    ? namedChildrenGet(bodyNode)
    : bodyNode.type === 'else_clause'
      ? namedChildrenGet(bodyNode)
      : [bodyNode];

  if (stmts.length === 0) return [branchId]; // Empty block — branchId is still live

  // Track edge count before processing so we can relabel the first new edge
  const edgeCountBefore = builder.edges.length;

  const live = statementsProcess(builder, stmts, [branchId], exitId);

  // Relabel the first edge from branchId that was added during this processing
  for (let i = edgeCountBefore; i < builder.edges.length; i++) {
    if (builder.edges[i].from === branchId) {
      builder.edges[i].label = edgeLabel;
      break;
    }
  }

  return live;
}

// ============================================================================
// Control Flow: while
// ============================================================================

/**
 *   predecessors → loop
 *   loop --true--> body → loop (back-edge)
 *   loop --false--> merge
 */
function whileProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId
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

  // Body
  if (body) {
    const bodyStmts = body.type === 'statement_block' ? namedChildrenGet(body) : [body];
    if (bodyStmts.length > 0) {
      const edgeCountBefore = builder.edges.length;
      const bodyLive = statementsProcess(builder, bodyStmts, [loop.id], exitId);
      // Relabel first edge from loop as 'true'
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

  const merge = nodeAdd(builder, 'merge', undefined, 'while-exit');
  edgeAdd(builder, loop.id, merge.id, 'false');
  return [merge.id];
}

// ============================================================================
// Control Flow: for
// ============================================================================

/**
 *   predecessors → [init] → loop(condition)
 *   loop --true--> body → [increment] → loop (back-edge)
 *   loop --false--> merge
 */
function forProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId
): FlowNodeId[] {
  const initializer = stmt.childForFieldName('initializer');
  const condition = stmt.childForFieldName('condition');
  const increment = stmt.childForFieldName('increment');
  const body = stmt.childForFieldName('body');

  let current = [...predecessors];

  // Init
  if (initializer) {
    const initNode = nodeAdd(builder, 'statement', byteRangeFromNode(initializer), 'for-init');
    for (const pred of current) {
      edgeAdd(builder, pred, initNode.id, 'unconditional');
    }
    current = [initNode.id];
  }

  // Loop condition
  const loop = nodeAdd(
    builder, 'loop',
    condition ? byteRangeFromNode(condition) : byteRangeFromNode(stmt),
    'for'
  );
  for (const pred of current) {
    edgeAdd(builder, pred, loop.id, 'unconditional');
  }

  // Body
  if (body) {
    const bodyStmts = body.type === 'statement_block' ? namedChildrenGet(body) : [body];
    if (bodyStmts.length > 0) {
      const edgeCountBefore = builder.edges.length;
      let backEdgeSources = statementsProcess(builder, bodyStmts, [loop.id], exitId);
      // Relabel first edge from loop as 'true'
      for (let i = edgeCountBefore; i < builder.edges.length; i++) {
        if (builder.edges[i].from === loop.id) {
          builder.edges[i].label = 'true';
          break;
        }
      }

      // Increment
      if (increment && backEdgeSources.length > 0) {
        const incNode = nodeAdd(builder, 'statement', byteRangeFromNode(increment), 'for-increment');
        for (const live of backEdgeSources) {
          edgeAdd(builder, live, incNode.id, 'unconditional');
        }
        backEdgeSources = [incNode.id];
      }

      for (const src of backEdgeSources) {
        edgeAdd(builder, src, loop.id, 'loop-back');
      }
    } else {
      // Empty body
      if (increment) {
        const incNode = nodeAdd(builder, 'statement', byteRangeFromNode(increment), 'for-increment');
        edgeAdd(builder, loop.id, incNode.id, 'true');
        edgeAdd(builder, incNode.id, loop.id, 'loop-back');
      } else {
        edgeAdd(builder, loop.id, loop.id, 'true');
      }
    }
  }

  const merge = nodeAdd(builder, 'merge', undefined, 'for-exit');
  edgeAdd(builder, loop.id, merge.id, 'false');
  return [merge.id];
}

// ============================================================================
// Control Flow: do...while
// ============================================================================

/**
 *   predecessors → body-entry → [body] → loop(condition)
 *   loop --true--> body-entry (back-edge)
 *   loop --false--> merge
 */
function doWhileProcess(
  builder: CfgBuilder,
  stmt: Parser.SyntaxNode,
  predecessors: FlowNodeId[],
  exitId: FlowNodeId
): FlowNodeId[] {
  const body = stmt.childForFieldName('body');
  const conditionNode = stmt.childForFieldName('condition');

  // Body entry (also back-edge target)
  const bodyEntry = nodeAdd(builder, 'statement', byteRangeFromNode(stmt), 'do-body-entry');
  for (const pred of predecessors) {
    edgeAdd(builder, pred, bodyEntry.id, 'unconditional');
  }

  // Process body
  let bodyLive: FlowNodeId[] = [bodyEntry.id];
  if (body) {
    const bodyStmts = body.type === 'statement_block' ? namedChildrenGet(body) : [body];
    bodyLive = statementsProcess(builder, bodyStmts, [bodyEntry.id], exitId);
  }

  // Loop condition (after body)
  const loop = nodeAdd(
    builder, 'loop',
    conditionNode ? byteRangeFromNode(conditionNode) : byteRangeFromNode(stmt),
    'do-while'
  );
  for (const live of bodyLive) {
    edgeAdd(builder, live, loop.id, 'unconditional');
  }

  // Back-edge
  edgeAdd(builder, loop.id, bodyEntry.id, 'true');

  // Exit
  const merge = nodeAdd(builder, 'merge', undefined, 'do-while-exit');
  edgeAdd(builder, loop.id, merge.id, 'false');
  return [merge.id];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get named children of a node, filtering out comments.
 */
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

// ============================================================================
// Function Node Discovery
// ============================================================================

/** Tree-sitter node types that represent function-like constructs */
const FUNCTION_NODE_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'arrow_function',
  'method_definition',
  'function',             // function expression
  'generator_function',   // generator function expression
]);

/**
 * Collect all function-like AST nodes in the tree.
 */
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

/**
 * Find the scope that matches a function AST node by byte range.
 */
function scopeForFunctionFind(
  funcNode: Parser.SyntaxNode,
  scopes: ScopeRecord[]
): ScopeRecord | undefined {
  // For method_definition, the scope corresponds to the body.
  // Try matching the body range first.
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

  // Match by the function node's own range
  for (const scope of scopes) {
    if (scope.kind === 'function' &&
        scope.byteRange.start === funcNode.startIndex &&
        scope.byteRange.end === funcNode.endIndex) {
      return scope;
    }
  }

  // Broadest fallback: tightest function scope containing this node
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

/**
 * Extract control flow graphs for all function-like scopes in a file.
 *
 * @param tree - The parsed Tree-sitter tree
 * @param file - Absolute file path (unused but kept for consistency)
 * @param scopes - Scopes already extracted from the file
 * @returns Array of FlowGraph, one per function scope
 */
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

    if (body.type === 'statement_block') {
      const stmts = namedChildrenGet(body);
      if (stmts.length === 0) {
        // Empty function: entry → exit
        edgeAdd(builder, builder.entryId, builder.exitId, 'unconditional');
      } else {
        const live = statementsProcess(builder, stmts, [builder.entryId], builder.exitId);
        // Implicit return for remaining live paths
        for (const id of live) {
          edgeAdd(builder, id, builder.exitId, 'unconditional');
        }
      }
    } else {
      // Arrow function with expression body: entry → expr → exit
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

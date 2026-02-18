/**
 * @packageDocumentation
 * Core Tree-sitter adapter implementation.
 *
 * This module provides the shared logic for extracting semantic information
 * from Tree-sitter parse results. Language-specific adapters provide
 * configuration (queries, kind mappings) while this module handles execution.
 */

import Parser from 'web-tree-sitter';
import { createHash } from 'node:crypto';
import type {
  SymbolId,
  ScopeId,
  SymbolKind,
  ScopeKind,
  ByteRange,
  SymbolRecord,
  ScopeRecord,
  RelationRecord,
  DefinesRelation,
  ContainsRelation,
  ReferencesRelation,
  CallsRelation,
  ImportsRelation,
  ImportBindingRelation,
  ExportsRelation,
  TypeRelation,
} from '../../index/indexTypes';
import { SymbolFlags } from '../../index/indexTypes';
import type {
  LangConfig,
  FileIndexDelta,
  AdapterDiagnostic,
  RefFilterContext,
} from './adapterTypes';
import { cfgsExtract as cfgsExtractFromTree } from './cfgBuild';

// ============================================================================
// Stable ID Generation
// ============================================================================

/**
 * Generate a stable hash ID from parts.
 * Uses SHA-256, truncated to 24 hex characters.
 */
function hashId(...parts: string[]): string {
  return createHash('sha256')
    .update(parts.join('\0'))
    .digest('hex')
    .slice(0, 24);
}

/**
 * Generate a stable SymbolId.
 * ID is deterministic based on language, file, kind, qualified name, and position.
 */
function symbolIdCreate(
  languageId: string,
  file: string,
  kind: SymbolKind,
  qualName: string,
  startByte: number
): SymbolId {
  return hashId(languageId, file, kind, qualName, String(startByte));
}

/**
 * Generate a stable ScopeId.
 */
function scopeIdCreate(
  languageId: string,
  file: string,
  kind: ScopeKind,
  startByte: number,
  endByte: number
): ScopeId {
  return hashId(languageId, file, `scope:${kind}`, String(startByte), String(endByte));
}

// ============================================================================
// Scope Building
// ============================================================================

/**
 * Build scope tree from Tree-sitter query captures.
 */
function scopesBuild(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string
): ScopeRecord[] {
  // Create file-level scope
  const fileScope: ScopeRecord = {
    id: scopeIdCreate(cfg.languageId, file, 'file', 0, tree.rootNode.endIndex),
    kind: 'file',
    file,
    byteRange: { start: 0, end: tree.rootNode.endIndex },
  };

  const scopes: ScopeRecord[] = [fileScope];

  // Parse and run scope query
  const query = cfg.language.query(cfg.queries.scopes);
  const captures = query.captures(tree.rootNode);

  for (const capture of captures) {
    if (capture.name !== cfg.captures.scopeNode) continue;

    const node = capture.node;
    const kind = scopeKindFromNode(cfg, node.type);

    scopes.push({
      id: scopeIdCreate(cfg.languageId, file, kind, node.startIndex, node.endIndex),
      kind,
      file,
      byteRange: { start: node.startIndex, end: node.endIndex },
    });
  }

  // Sort by byteRange for parent assignment (smaller ranges come after their parents)
  scopes.sort((a, b) => {
    const startDiff = a.byteRange.start - b.byteRange.start;
    if (startDiff !== 0) return startDiff;
    // If same start, larger byteRange (parent) comes first
    return b.byteRange.end - a.byteRange.end;
  });

  // Assign parents by finding smallest containing scope
  for (const scope of scopes) {
    if (scope.id === fileScope.id) continue;
    scope.parent = findParentScope(scopes, scope);
  }

  return scopes;
}

/**
 * Find the parent scope (smallest containing scope).
 */
function findParentScope(allScopes: ScopeRecord[], child: ScopeRecord): ScopeId {
  let best: ScopeRecord | undefined;

  for (const scope of allScopes) {
    if (scope.id === child.id) continue;

    // Check if scope contains child
    if (scope.byteRange.start <= child.byteRange.start && scope.byteRange.end >= child.byteRange.end) {
      // Pick smallest containing scope
      if (!best || (scope.byteRange.end - scope.byteRange.start) < (best.byteRange.end - best.byteRange.start)) {
        best = scope;
      }
    }
  }

  return best?.id ?? allScopes[0].id;
}

/**
 * Map node type to ScopeKind using language config.
 */
function scopeKindFromNode(cfg: LangConfig, nodeType: string): ScopeKind {
  const mapping = cfg.scopeKinds.byNodeType[nodeType];
  if (mapping) return mapping;

  // Heuristic fallback
  if (nodeType.includes('function') || nodeType.includes('method')) return 'function';
  if (nodeType.includes('class')) return 'class';
  if (nodeType.includes('module') || nodeType.includes('namespace')) return 'module';
  if (nodeType.includes('block')) return 'block';

  return cfg.scopeKinds.default;
}

/**
 * Find the innermost scope containing a byteRange.
 */
function findInnermostScope(scopes: ScopeRecord[], byteRange: ByteRange): ScopeId {
  let best: ScopeRecord | undefined;

  for (const scope of scopes) {
    if (scope.byteRange.start <= byteRange.start && scope.byteRange.end >= byteRange.end) {
      if (!best || (scope.byteRange.end - scope.byteRange.start) < (best.byteRange.end - best.byteRange.start)) {
        best = scope;
      }
    }
  }

  return best?.id ?? scopes[0].id;
}

// ============================================================================
// Symbol Extraction
// ============================================================================

/**
 * Extract symbol declarations from Tree-sitter query captures.
 */
function symbolsExtract(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string,
  source: string,
  scopes: ScopeRecord[]
): { symbols: SymbolRecord[]; declRanges: Set<string> } {
  const symbols: SymbolRecord[] = [];
  const declRanges = new Set<string>();

  const query = cfg.language.query(cfg.queries.symbols);
  const matches = query.matches(tree.rootNode);

  for (const match of matches) {
    const capturesByName = new Map<string, Parser.SyntaxNode>();
    for (const capture of match.captures) {
      capturesByName.set(capture.name, capture.node);
    }

    // Find name capture
    const nameNode = capturesByName.get(cfg.captures.symbolName);
    if (!nameNode) continue;

    // Find kind and declaration node from capture with decl prefix
    let kind: SymbolKind = cfg.symbolKinds.default;
    let declNode: Parser.SyntaxNode | undefined;
    for (const capture of match.captures) {
      if (capture.name.startsWith(cfg.captures.symbolKindPrefix + '.')) {
        declNode = capture.node;
        const suffix = capture.name.slice(cfg.captures.symbolKindPrefix.length + 1);
        const mappedKind = cfg.symbolKinds.byCaptureSuffix[suffix];
        if (mappedKind) {
          kind = mappedKind;
          break;
        }
      }
    }

    let name = sliceText(source, nameNode.startIndex, nameNode.endIndex);

    // For import bindings with alias (import { foo as bar }), use the alias as local name.
    // The tree-sitter import_specifier node has name: "foo" and alias: "bar".
    // The local binding is "bar", so symbol name must be "bar".
    if (declNode?.type === 'import_specifier') {
      const aliasNode = declNode.childForFieldName('alias');
      if (aliasNode) {
        name = sliceText(source, aliasNode.startIndex, aliasNode.endIndex);
      }
    }

    // Name range: used for dedup and scope lookup (the identifier position)
    const nameRange: ByteRange = { start: nameNode.startIndex, end: nameNode.endIndex };
    declRanges.add(`${nameRange.start}:${nameRange.end}`);

    const scopeId = findInnermostScope(scopes, nameRange);
    const qualName = buildQualifiedName(scopes, scopeId, name);
    const id = symbolIdCreate(cfg.languageId, file, kind, qualName, nameNode.startIndex);

    // Detect flags (basic heuristics)
    let flags = SymbolFlags.None;
    // Check for export in ancestors
    let current: Parser.SyntaxNode | null = nameNode.parent;
    while (current) {
      if (current.type.includes('export')) {
        flags |= SymbolFlags.Exported;
        break;
      }
      current = current.parent;
    }
    // Check for async keyword on declaration node
    if (declNode) {
      for (let i = 0; i < declNode.childCount; i++) {
        const child = declNode.child(i);
        if (child && child.type === 'async') {
          flags |= SymbolFlags.Async;
          break;
        }
      }
      // Check for generator declaration
      if (declNode.type.includes('generator')) {
        flags |= SymbolFlags.Generator;
      }
    }

    // Full declaration span for byteRange (enables caller/callee containment checks)
    const symbolRange: ByteRange = declNode
      ? { start: declNode.startIndex, end: declNode.endIndex }
      : nameRange;

    symbols.push({
      id,
      kind,
      name,
      file,
      byteRange: symbolRange,
      scopeId,
      qualName,
      flags,
    });
  }

  return { symbols, declRanges };
}

/**
 * Build a qualified name from scope chain.
 */
function buildQualifiedName(scopes: ScopeRecord[], scopeId: ScopeId, leafName: string): string {
  // Simple implementation: just use scope ID prefix
  // More sophisticated: walk scope chain and collect names
  return `${scopeId}::${leafName}`;
}

/**
 * Slice text from source string using character offsets.
 *
 * web-tree-sitter's `startIndex`/`endIndex` are character offsets into the
 * parsed JavaScript string, NOT UTF-8 byte offsets. Using them to index a
 * raw `Uint8Array` produces wrong results for files containing multi-byte
 * UTF-8 characters (e.g., `→` is 3 bytes in UTF-8 but 1 JS character).
 */
function sliceText(source: string, start: number, end: number): string {
  return source.slice(start, end);
}

// ============================================================================
// Reference Extraction
// ============================================================================

/**
 * Extract identifier references from Tree-sitter query captures.
 */
function refsExtract(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string,
  source: string,
  scopes: ScopeRecord[],
  symbols: SymbolRecord[],
  declRanges: Set<string>,
  _diags: AdapterDiagnostic[]
): ReferencesRelation[] {
  const refs: ReferencesRelation[] = [];

  const query = cfg.language.query(cfg.queries.refs);
  const captures = query.captures(tree.rootNode);

  // Build name -> symbol map for file-local resolution
  const symbolsByName = new Map<string, SymbolRecord[]>();
  for (const sym of symbols) {
    const existing = symbolsByName.get(sym.name) ?? [];
    existing.push(sym);
    symbolsByName.set(sym.name, existing);
  }

  for (const capture of captures) {
    // Check for ref prefix
    if (!capture.name.startsWith(cfg.captures.refPrefix)) continue;

    const node = capture.node;
    const name = sliceText(source, node.startIndex, node.endIndex);
    const byteRange: ByteRange = { start: node.startIndex, end: node.endIndex };

    // Skip if this is a declaration site
    const rangeKey = `${byteRange.start}:${byteRange.end}`;
    if (declRanges.has(rangeKey)) continue;

    // Apply custom filter if provided
    if (cfg.refFilter) {
      const ctx: RefFilterContext = {
        name,
        nodeType: node.type,
        parentType: node.parent?.type ?? '',
        grandparentType: node.parent?.parent?.type,
        byteRange,
        declarationRanges: declRanges,
      };
      if (!cfg.refFilter(ctx)) continue;
    }

    const scopeId = findInnermostScope(scopes, byteRange);

    // Try to resolve locally
    const resolved = resolveLocal(symbolsByName, name, scopeId, scopes);

    refs.push({
      kind: 'References',
      scopeId,
      name,
      byteRange,
      resolvedSymbolId: resolved?.id,
    });
  }

  return refs;
}

/**
 * Extract member expression references (e.g., utils.alpha) as dotted references.
 *
 * These references are used during cross-file resolution to resolve namespace
 * import member accesses (import * as X → X.foo) to the exported symbol.
 *
 * Creates a ReferencesRelation with name "obj.prop" where the resolvedSymbolId
 * initially points to the local symbol for the object (the namespace binding).
 */
function memberRefsExtract(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string,
  source: string,
  scopes: ScopeRecord[],
  symbols: SymbolRecord[],
  declRanges: Set<string>
): ReferencesRelation[] {
  const refs: ReferencesRelation[] = [];

  // Query for member expressions: obj.prop
  const memberQuery = cfg.language.query(
    `(member_expression
       object: (identifier) @member.obj
       property: (property_identifier) @member.prop)`
  );
  const matches = memberQuery.matches(tree.rootNode);

  // Build name -> symbol map for local resolution of the object part
  const symbolsByName = new Map<string, SymbolRecord[]>();
  for (const sym of symbols) {
    const existing = symbolsByName.get(sym.name) ?? [];
    existing.push(sym);
    symbolsByName.set(sym.name, existing);
  }

  for (const match of matches) {
    const capturesByName = new Map<string, Parser.SyntaxNode>();
    for (const capture of match.captures) {
      capturesByName.set(capture.name, capture.node);
    }

    const objNode = capturesByName.get('member.obj');
    const propNode = capturesByName.get('member.prop');
    if (!objNode || !propNode) continue;

    const objName = sliceText(source, objNode.startIndex, objNode.endIndex);
    const propName = sliceText(source, propNode.startIndex, propNode.endIndex);

    // Use the property identifier's range for the reference
    const byteRange: ByteRange = { start: propNode.startIndex, end: propNode.endIndex };

    // Skip if this falls on a declaration site
    const rangeKey = `${byteRange.start}:${byteRange.end}`;
    if (declRanges.has(rangeKey)) continue;

    const scopeId = findInnermostScope(scopes, byteRange);

    // Resolve the object to a local symbol (may be a namespace import)
    const objResolved = resolveLocal(symbolsByName, objName, scopeId, scopes);

    refs.push({
      kind: 'References',
      scopeId,
      name: `${objName}.${propName}`,
      byteRange,
      resolvedSymbolId: objResolved?.id,
    });
  }

  return refs;
}

/**
 * Try to resolve a reference to a symbol within the same file.
 * Uses scope-based shadowing rules.
 */
function resolveLocal(
  symbolsByName: Map<string, SymbolRecord[]>,
  name: string,
  scopeId: ScopeId,
  scopes: ScopeRecord[]
): SymbolRecord | undefined {
  const candidates = symbolsByName.get(name);
  if (!candidates || candidates.length === 0) return undefined;

  // Prefer symbol in same scope
  const inSameScope = candidates.find(s => s.scopeId === scopeId);
  if (inSameScope) return inSameScope;

  // Walk up scope chain
  const scopeById = new Map(scopes.map(s => [s.id, s]));
  let currentScopeId: ScopeId | undefined = scopeId;

  while (currentScopeId) {
    const scope = scopeById.get(currentScopeId);
    if (!scope) break;

    const inScope = candidates.find(s => s.scopeId === currentScopeId);
    if (inScope) return inScope;

    currentScopeId = scope.parent;
  }

  // Fall back to first candidate (file-level)
  return candidates[0];
}

// ============================================================================
// Call Extraction
// ============================================================================

/**
 * Extract call expressions from Tree-sitter query captures.
 */
function callsExtract(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string,
  source: string,
  scopes: ScopeRecord[],
  symbols: SymbolRecord[],
  _diags: AdapterDiagnostic[]
): CallsRelation[] {
  if (!cfg.queries.calls) return [];

  const calls: CallsRelation[] = [];

  const query = cfg.language.query(cfg.queries.calls);
  const matches = query.matches(tree.rootNode);

  // Build name -> symbol map for resolution
  const symbolsByName = new Map<string, SymbolRecord[]>();
  for (const sym of symbols) {
    if (sym.kind === 'function' || sym.kind === 'method') {
      const existing = symbolsByName.get(sym.name) ?? [];
      existing.push(sym);
      symbolsByName.set(sym.name, existing);
    }
  }

  for (const match of matches) {
    const capturesByName = new Map<string, Parser.SyntaxNode>();
    for (const capture of match.captures) {
      capturesByName.set(capture.name, capture.node);
    }

    // Find callee name
    let calleeName = '';
    let calleeNode: Parser.SyntaxNode | undefined;

    // Check for simple callee (callee.id)
    const idNode = capturesByName.get(cfg.captures.calleePrefix + '.id');
    if (idNode) {
      calleeName = sliceText(source, idNode.startIndex, idNode.endIndex);
      calleeNode = idNode;
    }

    // Check for member callee (callee.obj + callee.prop/callee.attr)
    const objNode = capturesByName.get(cfg.captures.calleePrefix + '.obj');
    const propNode = capturesByName.get(cfg.captures.calleePrefix + '.prop') ??
                     capturesByName.get(cfg.captures.calleePrefix + '.attr');
    if (objNode && propNode) {
      const objName = sliceText(source, objNode.startIndex, objNode.endIndex);
      const propName = sliceText(source, propNode.startIndex, propNode.endIndex);
      calleeName = `${objName}.${propName}`;
      calleeNode = propNode;
    }

    if (!calleeName || !calleeNode) continue;

    const byteRange: ByteRange = { start: calleeNode.startIndex, end: calleeNode.endIndex };
    const scopeId = findInnermostScope(scopes, byteRange);

    // Try to resolve simple names
    let resolved: SymbolRecord | undefined;
    if (!calleeName.includes('.')) {
      const candidates = symbolsByName.get(calleeName);
      if (candidates && candidates.length > 0) {
        resolved = candidates[0];
      }
    }

    calls.push({
      kind: 'Calls',
      scopeId,
      calleeName,
      byteRange,
      resolvedSymbolId: resolved?.id,
    });
  }

  return calls;
}

// ============================================================================
// Import Extraction
// ============================================================================

/**
 * Extract import statements from Tree-sitter query captures.
 */
function importsExtract(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string,
  source: string,
  scopes: ScopeRecord[],
  _diags: AdapterDiagnostic[]
): ImportsRelation[] {
  if (!cfg.queries.imports) return [];

  const imports: ImportsRelation[] = [];

  const query = cfg.language.query(cfg.queries.imports);
  const captures = query.captures(tree.rootNode);

  for (const capture of captures) {
    if (!capture.name.startsWith(cfg.captures.importPrefix)) continue;

    const node = capture.node;
    let spec = sliceText(source, node.startIndex, node.endIndex);

    // Remove quotes from string literals
    if ((spec.startsWith('"') && spec.endsWith('"')) ||
        (spec.startsWith("'") && spec.endsWith("'"))) {
      spec = spec.slice(1, -1);
    }

    const byteRange: ByteRange = { start: node.startIndex, end: node.endIndex };
    const scopeId = findInnermostScope(scopes, byteRange);

    imports.push({
      kind: 'Imports',
      scopeId,
      spec,
      byteRange,
    });
  }

  return imports;
}

// ============================================================================
// Import Binding Extraction
// ============================================================================

/**
 * Extract import bindings for cross-file resolution.
 * Creates ImportBindingRelation for each imported name.
 */
function importBindingsExtract(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string,
  source: string,
  scopes: ScopeRecord[],
  symbols: SymbolRecord[],
  _diags: AdapterDiagnostic[]
): ImportBindingRelation[] {
  if (!cfg.queries.imports) return [];

  const bindings: ImportBindingRelation[] = [];
  const query = cfg.language.query(cfg.queries.imports);
  const matches = query.matches(tree.rootNode);

  // Build a map of symbol names to symbol IDs for linking import bindings
  const symbolsByNameAndRange = new Map<string, SymbolRecord>();
  for (const sym of symbols) {
    // Use name + byteRange start as key for more precise matching
    const key = `${sym.name}:${sym.byteRange.start}`;
    symbolsByNameAndRange.set(key, sym);
  }

  // Also by name only for fallback
  const symbolsByName = new Map<string, SymbolRecord[]>();
  for (const sym of symbols) {
    const existing = symbolsByName.get(sym.name) ?? [];
    existing.push(sym);
    symbolsByName.set(sym.name, existing);
  }

  for (const match of matches) {
    const capturesByName = new Map<string, Parser.SyntaxNode>();
    for (const capture of match.captures) {
      capturesByName.set(capture.name, capture.node);
    }

    // Get module specifier
    let moduleSpec = '';
    const sourceNode = capturesByName.get('import.source') ??
                       capturesByName.get('import.require_source') ??
                       capturesByName.get('import.dynamic_source') ??
                       capturesByName.get('import.from_module') ??
                       capturesByName.get('import.relative_module');
    if (sourceNode) {
      moduleSpec = sliceText(source, sourceNode.startIndex, sourceNode.endIndex);
      // Remove quotes
      if ((moduleSpec.startsWith('"') && moduleSpec.endsWith('"')) ||
          (moduleSpec.startsWith("'") && moduleSpec.endsWith("'"))) {
        moduleSpec = moduleSpec.slice(1, -1);
      }
    }

    if (!moduleSpec) continue;

    // Determine byteRange for the entire import statement
    let importRange: ByteRange = { start: 0, end: 0 };
    for (const capture of match.captures) {
      if (capture.name.startsWith('import.') && 
          (capture.name.endsWith('.named') || 
           capture.name.endsWith('.default') || 
           capture.name.endsWith('.namespace') ||
           capture.name.endsWith('.module') ||
           capture.name.endsWith('.from') ||
           capture.name.endsWith('.relative'))) {
        importRange = { start: capture.node.startIndex, end: capture.node.endIndex };
        break;
      }
    }

    // Handle named imports: import { foo, bar as baz } from "module"
    const bindingNameNode = capturesByName.get('import.binding_name');
    if (bindingNameNode) {
      const importedName = sliceText(source, bindingNameNode.startIndex, bindingNameNode.endIndex);
      // Check for alias via the tree-sitter node (import { foo as bar } -> alias field = "bar")
      const specifierNode = bindingNameNode.parent;
      const aliasNode = specifierNode?.childForFieldName('alias');
      const localName = aliasNode 
        ? sliceText(source, aliasNode.startIndex, aliasNode.endIndex)
        : importedName;

      // Find the corresponding symbol
      const localSymbol = findImportSymbol(symbolsByName, localName, bindingNameNode.startIndex);
      if (localSymbol) {
        bindings.push({
          kind: 'ImportBinding',
          localSymbolId: localSymbol.id,
          importedName,
          moduleSpec,
          isDefault: false,
          isNamespace: false,
          byteRange: importRange.end > 0 ? importRange : { start: bindingNameNode.startIndex, end: bindingNameNode.endIndex },
        });
      }
    }

    // Handle default imports: import foo from "module"
    const defaultNameNode = capturesByName.get('import.default_name');
    if (defaultNameNode) {
      const localName = sliceText(source, defaultNameNode.startIndex, defaultNameNode.endIndex);
      const localSymbol = findImportSymbol(symbolsByName, localName, defaultNameNode.startIndex);
      if (localSymbol) {
        bindings.push({
          kind: 'ImportBinding',
          localSymbolId: localSymbol.id,
          importedName: 'default',
          moduleSpec,
          isDefault: true,
          isNamespace: false,
          byteRange: importRange.end > 0 ? importRange : { start: defaultNameNode.startIndex, end: defaultNameNode.endIndex },
        });
      }
    }

    // Handle namespace imports: import * as foo from "module"
    const namespaceNameNode = capturesByName.get('import.namespace_name');
    if (namespaceNameNode) {
      const localName = sliceText(source, namespaceNameNode.startIndex, namespaceNameNode.endIndex);
      const localSymbol = findImportSymbol(symbolsByName, localName, namespaceNameNode.startIndex);
      if (localSymbol) {
        bindings.push({
          kind: 'ImportBinding',
          localSymbolId: localSymbol.id,
          importedName: '*',
          moduleSpec,
          isDefault: false,
          isNamespace: true,
          byteRange: importRange.end > 0 ? importRange : { start: namespaceNameNode.startIndex, end: namespaceNameNode.endIndex },
        });
      }
    }

    // Handle require imports: const foo = require("module")
    const requireNameNode = capturesByName.get('import.require_name');
    if (requireNameNode) {
      const localName = sliceText(source, requireNameNode.startIndex, requireNameNode.endIndex);
      const localSymbol = findImportSymbol(symbolsByName, localName, requireNameNode.startIndex);
      if (localSymbol) {
        bindings.push({
          kind: 'ImportBinding',
          localSymbolId: localSymbol.id,
          importedName: 'default',
          moduleSpec,
          isDefault: true,
          isNamespace: false,
          byteRange: importRange.end > 0 ? importRange : { start: requireNameNode.startIndex, end: requireNameNode.endIndex },
        });
      }
    }

    // Handle destructured require: const { foo } = require("module")
    const requireBindingNode = capturesByName.get('import.require_binding');
    if (requireBindingNode) {
      const localName = sliceText(source, requireBindingNode.startIndex, requireBindingNode.endIndex);
      const localSymbol = findImportSymbol(symbolsByName, localName, requireBindingNode.startIndex);
      if (localSymbol) {
        bindings.push({
          kind: 'ImportBinding',
          localSymbolId: localSymbol.id,
          importedName: localName,
          moduleSpec,
          isDefault: false,
          isNamespace: false,
          byteRange: importRange.end > 0 ? importRange : { start: requireBindingNode.startIndex, end: requireBindingNode.endIndex },
        });
      }
    }

    // Handle dynamic import (whole-module): const mod = await import("module")
    // Creates a namespace-like binding, same as `import * as mod from "module"`.
    const dynamicNameNode = capturesByName.get('import.dynamic_name');
    if (dynamicNameNode) {
      const localName = sliceText(source, dynamicNameNode.startIndex, dynamicNameNode.endIndex);
      const localSymbol = findImportSymbol(symbolsByName, localName, dynamicNameNode.startIndex);
      if (localSymbol) {
        bindings.push({
          kind: 'ImportBinding',
          localSymbolId: localSymbol.id,
          importedName: '*',
          moduleSpec,
          isDefault: false,
          isNamespace: true,
          byteRange: importRange.end > 0 ? importRange : { start: dynamicNameNode.startIndex, end: dynamicNameNode.endIndex },
        });
      }
    }

    // Handle dynamic import (destructured): const { foo } = await import("module")
    const dynamicBindingNode = capturesByName.get('import.dynamic_binding');
    if (dynamicBindingNode) {
      const localName = sliceText(source, dynamicBindingNode.startIndex, dynamicBindingNode.endIndex);
      const localSymbol = findImportSymbol(symbolsByName, localName, dynamicBindingNode.startIndex);
      if (localSymbol) {
        bindings.push({
          kind: 'ImportBinding',
          localSymbolId: localSymbol.id,
          importedName: localName,
          moduleSpec,
          isDefault: false,
          isNamespace: false,
          byteRange: importRange.end > 0 ? importRange : { start: dynamicBindingNode.startIndex, end: dynamicBindingNode.endIndex },
        });
      }
    }
  }

  return bindings;
}

/**
 * Find an import symbol by name, preferring symbols near the given position.
 */
function findImportSymbol(
  symbolsByName: Map<string, SymbolRecord[]>,
  name: string,
  nearPosition: number
): SymbolRecord | undefined {
  const candidates = symbolsByName.get(name);
  if (!candidates || candidates.length === 0) return undefined;

  // If only one, return it
  if (candidates.length === 1) return candidates[0];

  // Find the closest one to the position
  let closest: SymbolRecord | undefined;
  let closestDistance = Infinity;

  for (const sym of candidates) {
    const distance = Math.abs(sym.byteRange.start - nearPosition);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = sym;
    }
  }

  return closest;
}

// ============================================================================
// Export Extraction
// ============================================================================

/**
 * Result of export extraction. Includes the export relations and any
 * synthetic symbols created for anonymous default exports.
 */
type ExportsExtractResult = {
  exports: ExportsRelation[];
  syntheticSymbols: SymbolRecord[];
};

/**
 * Extract export statements for cross-file resolution.
 * Creates ExportsRelation for each exported symbol.
 *
 * Anonymous default exports (e.g., `export default class {}`) produce
 * synthetic SymbolRecords since they have no name node for `symbolsExtract`
 * to capture. These are returned in `syntheticSymbols` for the caller to
 * merge into the delta.
 */
function exportsExtract(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string,
  source: string,
  scopes: ScopeRecord[],
  symbols: SymbolRecord[],
  _diags: AdapterDiagnostic[]
): ExportsExtractResult {
  if (!cfg.queries.exports) return { exports: [], syntheticSymbols: [] };

  const exports: ExportsRelation[] = [];
  const query = cfg.language.query(cfg.queries.exports);
  const matches = query.matches(tree.rootNode);

  // Build symbol lookup maps
  const symbolsByName = new Map<string, SymbolRecord[]>();
  for (const sym of symbols) {
    const existing = symbolsByName.get(sym.name) ?? [];
    existing.push(sym);
    symbolsByName.set(sym.name, existing);
  }

  for (const match of matches) {
    const capturesByName = new Map<string, Parser.SyntaxNode>();
    for (const capture of match.captures) {
      capturesByName.set(capture.name, capture.node);
    }

    // Determine export byteRange
    let exportRange: ByteRange = { start: 0, end: 0 };
    for (const capture of match.captures) {
      if (capture.name.startsWith('export.') && 
          (capture.name.endsWith('.declaration') || 
           capture.name.endsWith('.named') || 
           capture.name.endsWith('.default') ||
           capture.name.endsWith('.reexport') ||
           capture.name.endsWith('.star'))) {
        exportRange = { start: capture.node.startIndex, end: capture.node.endIndex };
        break;
      }
    }

    // Handle export declarations: export const/function/class foo
    // Skip if this is a default export (export.default_name takes precedence)
    const declNameNode = capturesByName.get('export.decl_name');
    const defaultNameNode = capturesByName.get('export.default_name');
    if (declNameNode && !defaultNameNode) {
      const exportedName = sliceText(source, declNameNode.startIndex, declNameNode.endIndex);
      const symbol = findExportSymbol(symbolsByName, exportedName, declNameNode.startIndex);
      if (symbol) {
        exports.push({
          kind: 'Exports',
          symbolId: symbol.id,
          exportedName,
          isDefault: false,
          byteRange: exportRange.end > 0 ? exportRange : { start: declNameNode.startIndex, end: declNameNode.endIndex },
        });
      }
    }

    // Handle named exports: export { foo } or export { foo as bar }
    // Also handles type-only named exports: export type { Foo }
    // (tree-sitter produces identical export_clause > export_specifier structure
    // for both; the "type" keyword is just an extra unnamed child of export_statement)
    const namedNode = capturesByName.get('export.name');
    if (namedNode && !capturesByName.get('export.reexport_source')) {
      const symbolName = sliceText(source, namedNode.startIndex, namedNode.endIndex);
      // Check for alias via the tree-sitter node (export { foo as bar } -> alias field = "bar")
      const specifierNode = namedNode.parent;
      const exportAliasNode = specifierNode?.childForFieldName('alias');
      const exportedName = exportAliasNode 
        ? sliceText(source, exportAliasNode.startIndex, exportAliasNode.endIndex)
        : symbolName;
      const symbol = findExportSymbol(symbolsByName, symbolName, namedNode.startIndex);
      if (symbol) {
        // Set Exported flag on the symbol — for separate named exports
        // (e.g., `export { foo }` or `export type { Foo }`), the symbol
        // declaration itself is not inside an export_statement, so the flag
        // was not set during symbolsExtract.
        symbol.flags |= SymbolFlags.Exported;
        exports.push({
          kind: 'Exports',
          symbolId: symbol.id,
          exportedName,
          isDefault: false,
          byteRange: exportRange.end > 0 ? exportRange : { start: namedNode.startIndex, end: namedNode.endIndex },
        });
      }
    }

    // Handle default exports: export default foo
    if (defaultNameNode) {
      const symbolName = sliceText(source, defaultNameNode.startIndex, defaultNameNode.endIndex);
      const symbol = findExportSymbol(symbolsByName, symbolName, defaultNameNode.startIndex);
      if (symbol) {
        exports.push({
          kind: 'Exports',
          symbolId: symbol.id,
          exportedName: 'default',
          isDefault: true,
          byteRange: exportRange.end > 0 ? exportRange : { start: defaultNameNode.startIndex, end: defaultNameNode.endIndex },
        });
      }
    }

    // Handle re-exports: export { foo } from "module"
    const reexportNameNode = capturesByName.get('export.reexport_name');
    const reexportSourceNode = capturesByName.get('export.reexport_source');
    const reexportAliasNode = capturesByName.get('export.reexport_alias');
    if (reexportNameNode && reexportSourceNode) {
      const sourceName = sliceText(source, reexportNameNode.startIndex, reexportNameNode.endIndex);
      const exportedName = reexportAliasNode
        ? sliceText(source, reexportAliasNode.startIndex, reexportAliasNode.endIndex)
        : sourceName;
      let sourceModule = sliceText(source, reexportSourceNode.startIndex, reexportSourceNode.endIndex);
      // Remove quotes
      if ((sourceModule.startsWith('"') && sourceModule.endsWith('"')) ||
          (sourceModule.startsWith("'") && sourceModule.endsWith("'"))) {
        sourceModule = sourceModule.slice(1, -1);
      }

      // For re-exports, we don't have a local symbol - create a placeholder
      // The symbolId will be resolved during cross-file resolution
      exports.push({
        kind: 'Exports',
        symbolId: '', // Will be resolved during cross-file resolution
        exportedName,
        isDefault: false,
        sourceModule,
        sourceName,
        byteRange: exportRange.end > 0 ? exportRange : { start: reexportNameNode.startIndex, end: reexportNameNode.endIndex },
      });
    }

    // Handle star re-exports: export * from "module"
    const starSourceNode = capturesByName.get('export.star_source');
    if (starSourceNode) {
      let sourceModule = sliceText(source, starSourceNode.startIndex, starSourceNode.endIndex);
      if ((sourceModule.startsWith('"') && sourceModule.endsWith('"')) ||
          (sourceModule.startsWith("'") && sourceModule.endsWith("'"))) {
        sourceModule = sourceModule.slice(1, -1);
      }

      // Star exports are handled specially during resolution
      exports.push({
        kind: 'Exports',
        symbolId: '', // Placeholder for star export
        exportedName: '*',
        isDefault: false,
        sourceModule,
        sourceName: '*',
        byteRange: { start: starSourceNode.startIndex, end: starSourceNode.endIndex },
      });
    }

    // Handle namespace re-exports: export * as ns from "module"
    const nsNameNode = capturesByName.get('export.namespace_name');
    const nsSourceNode = capturesByName.get('export.namespace_source');
    if (nsNameNode && nsSourceNode) {
      const exportedName = sliceText(source, nsNameNode.startIndex, nsNameNode.endIndex);
      let sourceModule = sliceText(source, nsSourceNode.startIndex, nsSourceNode.endIndex);
      if ((sourceModule.startsWith('"') && sourceModule.endsWith('"')) ||
          (sourceModule.startsWith("'") && sourceModule.endsWith("'"))) {
        sourceModule = sourceModule.slice(1, -1);
      }

      // Namespace re-exports bundle all source exports under a single name.
      // sourceName='*' with a non-'*' exportedName signals this pattern to
      // exportMapAddReexportedSymbols, which creates a sentinel ID for
      // namespace-style resolution in crossFileResolve.
      exports.push({
        kind: 'Exports',
        symbolId: '',
        exportedName,
        isDefault: false,
        sourceModule,
        sourceName: '*',
        byteRange: { start: nsNameNode.startIndex, end: nsSourceNode.endIndex },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Anonymous default exports: export default class { } / function() { }
  // Query patterns can't capture these reliably because the declaration has
  // no name field. Walk root-level export_statement nodes and detect default
  // exports that weren't captured by any query pattern.
  // -------------------------------------------------------------------------
  const syntheticSymbols: SymbolRecord[] = [];
  const hasDefaultExport = exports.some(e => e.isDefault);

  if (!hasDefaultExport) {
    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const child = tree.rootNode.child(i);
      if (!child || child.type !== 'export_statement') continue;

      // Check for "default" keyword among children
      let hasDefault = false;
      let declChild: Parser.SyntaxNode | null = null;
      for (let j = 0; j < child.childCount; j++) {
        const c = child.child(j);
        if (!c) continue;
        if (c.type === 'default') hasDefault = true;
        // The declaration/value child is the class or function node
        if (c.type.includes('class') || c.type.includes('function')) {
          declChild = c;
        }
      }

      if (!hasDefault || !declChild) continue;

      // Check if this declaration has a name field — if it does, it should
      // have been captured by the named default export query pattern above.
      const nameNode = declChild.childForFieldName('name');
      if (nameNode) continue;

      // Anonymous default export: create a synthetic symbol
      const kind: SymbolKind = declChild.type.includes('class') ? 'class' : 'function';
      const declRange: ByteRange = { start: declChild.startIndex, end: declChild.endIndex };
      const scopeId = findInnermostScope(scopes, declRange);
      const qualName = buildQualifiedName(scopes, scopeId, 'default');
      const syntheticId = symbolIdCreate(cfg.languageId, file, kind, qualName, declChild.startIndex);

      syntheticSymbols.push({
        id: syntheticId,
        kind,
        name: 'default',
        file,
        byteRange: declRange,
        scopeId,
        qualName,
        flags: SymbolFlags.Exported,
      });

      exports.push({
        kind: 'Exports',
        symbolId: syntheticId,
        exportedName: 'default',
        isDefault: true,
        byteRange: { start: child.startIndex, end: child.endIndex },
      });

      // At most one default export per file
      break;
    }
  }

  // Deduplicate exports: if we have both a named export and default export for the same symbol,
  // keep only the default export (for `export default class Foo` patterns)
  const symbolsWithDefault = new Set<string>();
  for (const exp of exports) {
    if (exp.isDefault && exp.symbolId) {
      symbolsWithDefault.add(exp.symbolId);
    }
  }
  
  const dedupedExports = exports.filter(exp => {
    // Keep default exports
    if (exp.isDefault) return true;
    // Keep exports for symbols without a default export
    if (!symbolsWithDefault.has(exp.symbolId)) return true;
    // Skip non-default exports for symbols that have a default export
    return false;
  });

  return { exports: dedupedExports, syntheticSymbols };
}

/**
 * Find an export symbol by name, preferring symbols near the given position.
 */
function findExportSymbol(
  symbolsByName: Map<string, SymbolRecord[]>,
  name: string,
  nearPosition: number
): SymbolRecord | undefined {
  const candidates = symbolsByName.get(name);
  if (!candidates || candidates.length === 0) return undefined;

  // For exports, prefer file-scope symbols
  const fileLevel = candidates.filter(s => s.scopeId.includes('scope:file'));
  if (fileLevel.length === 1) return fileLevel[0];
  if (fileLevel.length > 1) {
    // Find closest to position
    let closest: SymbolRecord | undefined;
    let closestDistance = Infinity;
    for (const sym of fileLevel) {
      const distance = Math.abs(sym.byteRange.start - nearPosition);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = sym;
      }
    }
    return closest;
  }

  // Fall back to any symbol
  return candidates[0];
}

// ============================================================================
// Main Indexing Function
// ============================================================================

// ============================================================================
// Type Relation Extraction
// ============================================================================

/**
 * Extract type relations (extends/implements) from Tree-sitter query captures.
 *
 * Captures patterns like:
 * - `class Foo extends Bar`
 * - `class Foo implements IBar, IBaz`
 * - `interface IFoo extends IBar`
 * - `abstract class AbstractFoo extends Bar implements IBar`
 *
 * For file-local targets, `resolvedTargetId` is populated by looking up
 * the target name in the same file's symbol table.
 */
function typeRelationsExtract(
  cfg: LangConfig,
  tree: Parser.Tree,
  file: string,
  source: string,
  symbols: SymbolRecord[],
  _diags: AdapterDiagnostic[]
): TypeRelation[] {
  if (!cfg.queries.typeRelations) return [];

  const typeRelations: TypeRelation[] = [];
  const query = cfg.language.query(cfg.queries.typeRelations);
  const matches = query.matches(tree.rootNode);

  // Build symbol lookup by name for local resolution
  const symbolsByName = new Map<string, SymbolRecord[]>();
  for (const sym of symbols) {
    const existing = symbolsByName.get(sym.name) ?? [];
    existing.push(sym);
    symbolsByName.set(sym.name, existing);
  }

  for (const match of matches) {
    const capturesByName = new Map<string, Parser.SyntaxNode>();
    for (const capture of match.captures) {
      capturesByName.set(capture.name, capture.node);
    }

    // Get the child (declaring) class/interface name
    const childNameNode = capturesByName.get('typerel.child_name');
    if (!childNameNode) continue;

    const childName = sliceText(source, childNameNode.startIndex, childNameNode.endIndex);

    // Find the child symbol in the symbol table
    const childSymbol = findExportSymbol(symbolsByName, childName, childNameNode.startIndex);
    if (!childSymbol) continue;

    // Determine extends vs implements and get target name node
    const extendsTargetNode = capturesByName.get('typerel.extends_target');
    const implementsTargetNode = capturesByName.get('typerel.implements_target');

    if (extendsTargetNode) {
      const targetName = sliceText(source, extendsTargetNode.startIndex, extendsTargetNode.endIndex);
      const byteRange: ByteRange = {
        start: extendsTargetNode.startIndex,
        end: extendsTargetNode.endIndex,
      };

      // Attempt file-local resolution
      const targetSymbol = findExportSymbol(symbolsByName, targetName, extendsTargetNode.startIndex);

      typeRelations.push({
        kind: 'TypeRelation',
        symbolId: childSymbol.id,
        targetName,
        relationKind: 'extends',
        byteRange,
        resolvedTargetId: targetSymbol?.id,
      });
    }

    if (implementsTargetNode) {
      const targetName = sliceText(source, implementsTargetNode.startIndex, implementsTargetNode.endIndex);
      const byteRange: ByteRange = {
        start: implementsTargetNode.startIndex,
        end: implementsTargetNode.endIndex,
      };

      // Attempt file-local resolution
      const targetSymbol = findExportSymbol(symbolsByName, targetName, implementsTargetNode.startIndex);

      typeRelations.push({
        kind: 'TypeRelation',
        symbolId: childSymbol.id,
        targetName,
        relationKind: 'implements',
        byteRange,
        resolvedTargetId: targetSymbol?.id,
      });
    }
  }

  return typeRelations;
}

/**
 * Index a file using Tree-sitter and return the delta.
 *
 * @param cfg - Language configuration
 * @param file - Absolute file path
 * @param bytes - File contents as bytes
 * @param revision - Revision identifier (e.g., content hash)
 * @returns FileIndexDelta with symbols, scopes, and relations
 */
function indexFileWithTreeSitter(
  cfg: LangConfig,
  file: string,
  bytes: Uint8Array,
  revision: string
): FileIndexDelta {
  const parser = new Parser();
  parser.setLanguage(cfg.language);

  // web-tree-sitter expects a string; tree-sitter node indices (startIndex/endIndex)
  // are character offsets into this string, NOT UTF-8 byte offsets. All extraction
  // functions receive the string so sliceText can use string.slice() correctly.
  const sourceText = Buffer.from(bytes).toString('utf8');
  const tree = parser.parse(sourceText);
  const diags: AdapterDiagnostic[] = [];

  // Build scopes first
  const scopes = scopesBuild(cfg, tree, file);

  // Extract symbols
  const { symbols, declRanges } = symbolsExtract(cfg, tree, file, sourceText, scopes);

  // Build relations
  const relations: RelationRecord[] = [];

  // Defines relations
  for (const symbol of symbols) {
    relations.push({
      kind: 'Defines',
      scopeId: symbol.scopeId,
      symbolId: symbol.id,
    } satisfies DefinesRelation);
  }

  // Contains relations (scope nesting)
  for (const scope of scopes) {
    if (scope.parent) {
      relations.push({
        kind: 'Contains',
        scopeId: scope.parent,
        childScopeId: scope.id,
      } satisfies ContainsRelation);
    }
  }

  // References
  const refs = refsExtract(cfg, tree, file, sourceText, scopes, symbols, declRanges, diags);
  relations.push(...refs);

  // Member expression references (e.g., utils.alpha for namespace import resolution)
  const memberRefs = memberRefsExtract(cfg, tree, file, sourceText, scopes, symbols, declRanges);
  relations.push(...memberRefs);

  // Calls
  const calls = callsExtract(cfg, tree, file, sourceText, scopes, symbols, diags);
  relations.push(...calls);

  // Imports (basic module specifier tracking)
  const imports = importsExtract(cfg, tree, file, sourceText, scopes, diags);
  relations.push(...imports);

  // Import bindings (for cross-file resolution)
  const importBindings = importBindingsExtract(cfg, tree, file, sourceText, scopes, symbols, diags);
  relations.push(...importBindings);

  // Exports (for cross-file resolution)
  const { exports: exportRelations, syntheticSymbols } = exportsExtract(cfg, tree, file, sourceText, scopes, symbols, diags);
  relations.push(...exportRelations);

  // Merge synthetic symbols (from anonymous default exports) into the symbol list
  const allSymbols = syntheticSymbols.length > 0
    ? [...symbols, ...syntheticSymbols]
    : symbols;

  // Add Defines relations for synthetic symbols
  for (const sym of syntheticSymbols) {
    relations.push({
      kind: 'Defines',
      scopeId: sym.scopeId,
      symbolId: sym.id,
    } satisfies DefinesRelation);
  }

  // Type relations (extends/implements)
  const typeRelations = typeRelationsExtract(cfg, tree, file, sourceText, allSymbols, diags);
  relations.push(...typeRelations);

  // Control flow graphs (per function scope)
  const cfgs = cfgsExtractFromTree(tree, file, scopes);

  return {
    file,
    revision,
    symbols: allSymbols,
    scopes,
    relations,
    diagnostics: diags,
    cfgs,
  };
}

/**
 * Create an index adapter from a language configuration.
 */
export function indexAdapterCreate(cfg: LangConfig) {
  return {
    languageId: cfg.languageId,
    capabilities: {
      crossFileResolution: false,
      callGraph: 'heuristic' as const,
      symbolKinds: new Set(Object.values(cfg.symbolKinds.byCaptureSuffix)),
      limitations: [
        'File-local resolution only',
        'Call detection is heuristic (may miss indirect calls)',
        'No type information',
      ],
    },
    indexFile(file: string, bytes: Uint8Array, revision: string): FileIndexDelta {
      return indexFileWithTreeSitter(cfg, file, bytes, revision);
    },
  };
}

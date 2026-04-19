/**
 * @packageDocumentation
 * Member-shape extractor — Phase 9.4 / Gap 3.
 *
 * One job: walk tree-sitter `@shape.*` captures, group them by owner
 * (class / interface / type-alias-of-object), build a deterministic
 * {@link MemberShapeRelation} per owner, and enforce
 * {@link MEMBER_SHAPE_CAP_PER_TYPE}.
 *
 * The extractor never reaches into {@link IndexStore}; it returns the
 * relations and lets the adapter core merge them into the per-file
 * delta the same way `typeRelationsExtract` does.
 *
 * Members marked `private` (TypeScript keyword) and `#`-prefixed
 * (`#name`) are excluded here — the query captures every member; the
 * filter lives in this module so future languages can share the
 * portable filter (`#`-prefix is TypeScript-only today but the
 * `private`-keyword check is a no-op on languages that don't have
 * the keyword).
 */

import type Parser from 'web-tree-sitter';
import type {
  ByteRange,
  MemberShapeEntry,
  MemberShapeKind,
  MemberShapeRelation,
  SymbolId,
  SymbolRecord,
} from '../../index/indexTypes';
import { MEMBER_SHAPE_CAP_PER_TYPE } from '../../index/memberShapeConstants';

/**
 * Minimal language-pack input. Mirrors the shape `symbolFlowExtract`
 * uses so wiring in `indexFileWithTreeSitter` is symmetric.
 */
export type MemberShapeExtractInput = {
  /** Pre-compiled tree-sitter query (`MEMBER_SHAPE_QUERY`). */
  query: Parser.Query;
  /** Root node of the parsed file tree. */
  rootNode: Parser.SyntaxNode;
  /** Source text used to slice identifier names. */
  source: string;
  /** Absolute file path. */
  file: string;
  /**
   * File-local name → symbol map used to resolve owner names back to
   * the symbol id `MemberShapeRelation.ownerSymbolId`. The adapter
   * core builds this once and reuses it across extractors.
   */
  symbolsByName: Map<string, SymbolRecord[]>;
};

type OwnerAccumulator = {
  ownerSymbolId: SymbolId;
  byteRange: ByteRange;
  /** Members keyed by `(name, memberKind, isStatic)` for dedup. */
  members: Map<string, MemberShapeEntry>;
  truncated: boolean;
};

/**
 * Walk member-shape captures and build one relation per owner symbol.
 *
 * Owners with no captured public members are still emitted so the
 * cross-file pass can reason about empty interfaces (an empty interface
 * trivially matches every class — surprising but correct).
 */
export function memberShapeExtract(
  input: MemberShapeExtractInput,
): MemberShapeRelation[] {
  const matches = input.query.matches(input.rootNode);

  // Key owners by `(ownerNode.startIndex, ownerNode.endIndex)` because
  // a single owner declaration can produce many query matches (one per
  // captured member). The byte range plus the kind identify it uniquely.
  const owners = new Map<string, OwnerAccumulator>();

  for (const match of matches) {
    let ownerNode: Parser.SyntaxNode | undefined;
    let ownerNameNode: Parser.SyntaxNode | undefined;
    let memberNode: Parser.SyntaxNode | undefined;
    let memberNameNode: Parser.SyntaxNode | undefined;

    for (const capture of match.captures) {
      switch (capture.name) {
        case 'shape.owner.class':
        case 'shape.owner.interface':
        case 'shape.owner.type_alias':
          ownerNode = capture.node;
          break;
        case 'shape.owner_name':
          ownerNameNode = capture.node;
          break;
        case 'shape.member':
          memberNode = capture.node;
          break;
        case 'shape.member_name':
          memberNameNode = capture.node;
          break;
        default:
          break;
      }
    }

    if (!ownerNode || !ownerNameNode || !memberNode || !memberNameNode) {
      continue;
    }

    // Filter out private members. Both the TypeScript `private`
    // keyword and the `#`-prefix style produce members that are NOT
    // observable by structural typing, so they must not contribute to
    // a shape relation regardless of language.
    if (memberIsPrivate(memberNode, input.source, memberNameNode)) {
      continue;
    }

    const accumulatorKey = `${ownerNode.startIndex}:${ownerNode.endIndex}`;
    let accumulator = owners.get(accumulatorKey);
    if (!accumulator) {
      const ownerSymbol = findOwnerSymbol(
        input.symbolsByName,
        sliceText(input.source, ownerNameNode.startIndex, ownerNameNode.endIndex),
        ownerNameNode.startIndex,
      );
      if (!ownerSymbol) continue;
      accumulator = {
        ownerSymbolId: ownerSymbol.id,
        byteRange: { start: ownerNode.startIndex, end: ownerNode.endIndex },
        members: new Map(),
        truncated: false,
      };
      owners.set(accumulatorKey, accumulator);
    }

    const entry = memberShapeEntryBuild(memberNode, memberNameNode, input.source);
    if (!entry) continue;

    const memberKey = `${entry.name}\u0000${entry.memberKind}\u0000${entry.isStatic ? 's' : 'i'}`;
    if (accumulator.members.has(memberKey)) {
      // Same member captured twice (e.g., a getter + setter pair both
      // matched against the same body — guarded against here even
      // though the current TS query produces them as distinct
      // captures). Last write wins; arity / optional flags should
      // already be deterministic per (name, kind, isStatic).
      continue;
    }
    if (accumulator.members.size >= MEMBER_SHAPE_CAP_PER_TYPE) {
      accumulator.truncated = true;
      continue;
    }
    accumulator.members.set(memberKey, entry);
  }

  // Flatten accumulators into deterministic relations.
  const relations: MemberShapeRelation[] = [];
  for (const accumulator of owners.values()) {
    const members = [...accumulator.members.values()].sort(memberShapeEntryCompare);
    relations.push({
      kind: 'MemberShape',
      ownerSymbolId: accumulator.ownerSymbolId,
      file: input.file,
      byteRange: accumulator.byteRange,
      members,
      memberCountTruncated: accumulator.truncated,
    });
  }

  // Sort relations by `(ownerSymbolId)` so two runs over byte-identical
  // input produce byte-identical output.
  relations.sort((left, right) =>
    left.ownerSymbolId < right.ownerSymbolId
      ? -1
      : left.ownerSymbolId > right.ownerSymbolId
      ? 1
      : 0,
  );

  return relations;
}

function memberShapeEntryCompare(left: MemberShapeEntry, right: MemberShapeEntry): number {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  if (left.memberKind !== right.memberKind) {
    return left.memberKind < right.memberKind ? -1 : 1;
  }
  return 0;
}

function memberShapeEntryBuild(
  memberNode: Parser.SyntaxNode,
  nameNode: Parser.SyntaxNode,
  source: string,
): MemberShapeEntry | undefined {
  const name = sliceText(source, nameNode.startIndex, nameNode.endIndex);
  if (!name) return undefined;
  const memberKind = memberKindOf(memberNode);
  const isStatic = memberHasModifier(memberNode, 'static');
  const isOptional = memberHasOptionalMarker(memberNode);
  const paramArity = memberKind === 'method' || memberKind === 'getter' || memberKind === 'setter'
    ? memberParamArityOf(memberNode)
    : undefined;

  const entry: MemberShapeEntry = {
    name,
    memberKind,
    isOptional,
    isStatic,
  };
  if (paramArity !== undefined) {
    entry.paramArity = paramArity;
  }
  return entry;
}

/**
 * Map a captured member node to its canonical {@link MemberShapeKind}.
 *
 * The query covers `method_definition` / `method_signature` /
 * `abstract_method_signature` (methods, possibly accessors) and
 * `public_field_definition` / `property_signature` (properties).
 * Accessor (`get` / `set`) detection looks for the keyword child on
 * the AST node since tree-sitter exposes them as method-shaped nodes
 * with a leading `get` / `set` token.
 */
function memberKindOf(memberNode: Parser.SyntaxNode): MemberShapeKind {
  if (
    memberNode.type === 'public_field_definition' ||
    memberNode.type === 'property_signature'
  ) {
    return 'property';
  }
  // Methods (and accessors). Inspect the token children for a leading
  // `get` / `set` keyword to distinguish accessor pairs.
  for (let i = 0; i < memberNode.childCount; i++) {
    const child = memberNode.child(i);
    if (!child) continue;
    if (child.type === 'get') return 'getter';
    if (child.type === 'set') return 'setter';
    // Stop scanning once we hit the name / parameter list — modifiers
    // and accessor keywords always come first in the AST.
    if (
      child.type === 'property_identifier' ||
      child.type === 'private_property_identifier' ||
      child.type === 'formal_parameters'
    ) {
      break;
    }
  }
  return 'method';
}

function memberParamArityOf(memberNode: Parser.SyntaxNode): number | undefined {
  const params =
    memberNode.childForFieldName('parameters') ??
    childOfType(memberNode, 'formal_parameters');
  if (!params) return undefined;
  let arity = 0;
  for (let i = 0; i < params.namedChildCount; i++) {
    const child = params.namedChild(i);
    if (!child) continue;
    if (
      child.type === 'required_parameter' ||
      child.type === 'optional_parameter'
    ) {
      arity += 1;
    }
  }
  return arity;
}

function memberHasModifier(
  memberNode: Parser.SyntaxNode,
  modifier: 'static' | 'private',
): boolean {
  // Modifiers appear as bare token children before the member name.
  for (let i = 0; i < memberNode.childCount; i++) {
    const child = memberNode.child(i);
    if (!child) continue;
    if (child.type === modifier) return true;
    if (child.type === 'accessibility_modifier' && child.text === modifier) {
      return true;
    }
    if (
      child.type === 'property_identifier' ||
      child.type === 'private_property_identifier' ||
      child.type === 'formal_parameters'
    ) {
      break;
    }
  }
  return false;
}

function memberHasOptionalMarker(memberNode: Parser.SyntaxNode): boolean {
  // Optional markers: `foo?: string` on a property_signature, or a
  // standalone `?` token before the type annotation on method/property
  // signatures. Tree-sitter exposes these as an `optional_parameter` /
  // bare `?` token sibling of the name node.
  for (let i = 0; i < memberNode.childCount; i++) {
    const child = memberNode.child(i);
    if (!child) continue;
    if (child.type === '?') return true;
  }
  return false;
}

function memberIsPrivate(
  memberNode: Parser.SyntaxNode,
  source: string,
  nameNode: Parser.SyntaxNode,
): boolean {
  // `#name` style — private property identifier nodes.
  if (nameNode.type === 'private_property_identifier') return true;
  const name = sliceText(source, nameNode.startIndex, nameNode.endIndex);
  if (name.startsWith('#')) return true;
  // TypeScript `private` keyword on the member.
  if (memberHasModifier(memberNode, 'private')) return true;
  return false;
}

function findOwnerSymbol(
  symbolsByName: Map<string, SymbolRecord[]>,
  name: string,
  nearPosition: number,
): SymbolRecord | undefined {
  const candidates = symbolsByName.get(name);
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  // Prefer the candidate whose declaration starts closest to the
  // owner-name capture position. Mirrors `findExportSymbol`.
  let closest: SymbolRecord | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.byteRange.start - nearPosition);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest;
}

function childOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return child;
  }
  return undefined;
}

function sliceText(source: string, start: number, end: number): string {
  return source.slice(start, end);
}

/**
 * @packageDocumentation
 * TypeScript/TSX language adapter configuration.
 */

import type { Language } from 'web-tree-sitter';
import type { LangConfig, RefFilterContext } from '../../adapterTypes';
import { CAPTURE_NAMES_DEFAULT } from '../../adapterTypes';

// Query pack content (loaded from .scm files or embedded)
import { SCOPES_QUERY } from './queries/scopes';
import { SYMBOLS_QUERY } from './queries/symbols';
import { REFS_QUERY } from './queries/refs';
import { CALLS_QUERY } from './queries/calls';
import { IMPORTS_QUERY } from './queries/imports';
import { EXPORTS_QUERY } from './queries/exports';
import { TYPE_RELATIONS_QUERY } from './queries/typeRelations';

/**
 * Reference filter for TypeScript.
 * Filters out identifiers that are not true references.
 */
function typescriptRefFilter(ctx: RefFilterContext): boolean {
  // Object-literal `pair`: skip only the key field (not value reads like `{ a: start }`).
  if (ctx.parentType === 'pair') {
    if (ctx.pairParentField === 'key') return false;
    return true;
  }

  // Interface / type-literal member: skip the property name; keep type references.
  if (ctx.parentType === 'property_signature') {
    if (ctx.propertySignatureParentField === 'name') return false;
    return true;
  }

  // Skip labels
  if (ctx.parentType === 'labeled_statement' || ctx.parentType === 'break_statement' ||
      ctx.parentType === 'continue_statement') {
    return false;
  }

  // Skip import/export specifier names (handled separately)
  if (ctx.parentType === 'import_specifier' || ctx.parentType === 'export_specifier') {
    return false;
  }

  // Skip type parameters
  if (ctx.parentType === 'type_parameter') {
    return false;
  }

  // Skip property identifiers that are just member names (not object refs)
  if (ctx.nodeType === 'property_identifier' && ctx.parentType === 'member_expression') {
    // This is the .prop part of obj.prop - we capture obj separately
    return false;
  }

  return true;
}

/**
 * Create TypeScript language configuration.
 *
 * @param language - Tree-sitter TypeScript Language object
 */
export function typescriptConfigCreate(language: Language): LangConfig {
  return {
    languageId: 'typescript',
    language,
    queries: {
      scopes: SCOPES_QUERY,
      symbols: SYMBOLS_QUERY,
      refs: REFS_QUERY,
      calls: CALLS_QUERY,
      imports: IMPORTS_QUERY,
      exports: EXPORTS_QUERY,
      typeRelations: TYPE_RELATIONS_QUERY,
    },
    captures: CAPTURE_NAMES_DEFAULT,
    symbolKinds: {
      byCaptureSuffix: {
        'class': 'class' as const,
        'abstract_class': 'class' as const,
        'interface': 'interface' as const,
        'type': 'type' as const,
        'enum': 'enum' as const,
        'enumMember': 'enumMember' as const,
        'namespace': 'namespace' as const,
        'function': 'function' as const,
        'generator': 'function' as const,
        'method': 'method' as const,
        'constructor': 'method' as const,
        'variable': 'variable' as const,
        'const': 'const' as const,
        'parameter': 'parameter' as const,
        'catch_binding': 'variable' as const,
        'function_expression_name': 'function' as const,
        'import_binding': 'variable' as const,
        'field': 'field' as const,
      },
      default: 'variable' as const,
    },
    scopeKinds: {
      byNodeType: {
        'class_declaration': 'class' as const,
        'abstract_class_declaration': 'class' as const,
        'function_declaration': 'function' as const,
        'generator_function_declaration': 'function' as const,
        'function_expression': 'function' as const,
        'arrow_function': 'function' as const,
        'method_definition': 'function' as const,
        'catch_clause': 'block' as const,
        'statement_block': 'block' as const,
      },
      default: 'block' as const,
    },
    refFilter: typescriptRefFilter,
  };
}

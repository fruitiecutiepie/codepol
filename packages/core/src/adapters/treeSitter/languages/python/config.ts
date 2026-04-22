/**
 * @packageDocumentation
 * Python language adapter configuration.
 */

import type { Language } from 'web-tree-sitter';
import type { LangConfig, RefFilterContext } from '../../adapterTypes';
import { CAPTURE_NAMES_DEFAULT } from '../../adapterTypes';

// Query pack content
import { SCOPES_QUERY } from './queries/scopes';
import { SYMBOLS_QUERY } from './queries/symbols';
import { REFS_QUERY } from './queries/refs';
import { CALLS_QUERY } from './queries/calls';
import { IMPORTS_QUERY } from './queries/imports';
import { EXPORTS_QUERY } from './queries/exports';
import { SYMBOL_FLOW_QUERY } from './queries/symbolFlow';
import { TYPE_RELATIONS_QUERY } from './queries/typeRelations';
import { MEMBER_SHAPE_QUERY } from './queries/memberShape';

/**
 * Reference filter for Python.
 * Filters out identifiers that are not true references.
 */
function pythonRefFilter(ctx: RefFilterContext): boolean {
  // Skip function/class definition names
  if (ctx.parentType === 'function_definition' || ctx.parentType === 'class_definition') {
    return false;
  }

  // Skip parameter names in function definitions
  if (ctx.parentType === 'parameters' || ctx.parentType === 'default_parameter' ||
      ctx.parentType === 'typed_parameter' || ctx.parentType === 'typed_default_parameter') {
    return false;
  }

  // Skip LHS of assignments (those are definitions)
  if (ctx.parentType === 'assignment' && ctx.grandparentType !== 'augmented_assignment') {
    // Check if we're on the left side - this is approximate
    return false;
  }

  // Skip import names
  if (ctx.parentType === 'dotted_name' && ctx.grandparentType === 'import_statement') {
    return false;
  }
  if (ctx.parentType === 'aliased_import') {
    return false;
  }

  // Skip for loop variable names
  if (ctx.parentType === 'for_statement') {
    return false;
  }

  // Skip except clause binding
  if (ctx.parentType === 'except_clause') {
    return false;
  }

  // Skip with statement binding
  if (ctx.parentType === 'with_clause' || ctx.parentType === 'with_item') {
    return false;
  }

  // Skip decorator names (they're references, but often to external code)
  // Keep them for now - they are references
  
  // Skip attribute access property names
  if (ctx.nodeType === 'identifier' && ctx.parentType === 'attribute') {
    // This might be obj.attr - we capture obj separately
    return false;
  }

  return true;
}

/**
 * Create Python language configuration.
 *
 * @param language - Tree-sitter Python Language object
 */
export function pythonConfigCreate(language: Language): LangConfig {
  return {
    languageId: 'python',
    language,
    queries: {
      scopes: SCOPES_QUERY,
      symbols: SYMBOLS_QUERY,
      refs: REFS_QUERY,
      calls: CALLS_QUERY,
      imports: IMPORTS_QUERY,
      exports: EXPORTS_QUERY,
      symbolFlow: SYMBOL_FLOW_QUERY,
      typeRelations: TYPE_RELATIONS_QUERY,
      memberShape: MEMBER_SHAPE_QUERY,
    },
    captures: CAPTURE_NAMES_DEFAULT,
    symbolKinds: {
      byCaptureSuffix: {
        'class': 'class' as const,
        'interface': 'interface' as const,
        'function': 'function' as const,
        'method': 'method' as const,
        'parameter': 'parameter' as const,
        'variable': 'variable' as const,
        'import_binding': 'variable' as const,
      },
      default: 'variable' as const,
    },
    scopeKinds: {
      byNodeType: {
        'module': 'file' as const,
        'class_definition': 'class' as const,
        'function_definition': 'function' as const,
        'lambda': 'function' as const,
        'for_statement': 'block' as const,
        'while_statement': 'block' as const,
        'with_statement': 'block' as const,
        'try_statement': 'block' as const,
        'except_clause': 'block' as const,
        'if_statement': 'block' as const,
      },
      default: 'block' as const,
    },
    refFilter: pythonRefFilter,
  };
}

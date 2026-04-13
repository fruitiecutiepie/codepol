import {
  CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS,
  CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH,
  CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION,
} from '../constants';

export function codepolHoverActionCommandResolve(
  action?: string,
): string | undefined {
  if (action === 'go_to_definition') {
    return CODEPOL_EXTENSION_COMMAND_SHOW_SEMANTIC_DEFINITION;
  }
  if (action === 'find_references') {
    return CODEPOL_EXTENSION_COMMAND_SHOW_ARCHITECTURE_LINKS;
  }
  if (action === 'show_graph') {
    return CODEPOL_EXTENSION_COMMAND_SHOW_DEPENDENCY_GRAPH;
  }
  return undefined;
}

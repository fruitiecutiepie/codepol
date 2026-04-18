/**
 * @packageDocumentation
 * Architecture check that enforces import direction rules between named
 * layers.
 *
 * A layer is a named collection of files (selected by glob), with an
 * optional `allows` whitelist and `denies` blacklist of layers it may
 * import from. The check classifies every indexed file into at most one
 * layer (most-specific glob wins; ties are reported as a violation),
 * walks every module-graph edge whose endpoints are both classified, and
 * emits one violation per disallowed edge.
 *
 * Edges between unclassified files (or from/to a classified file and an
 * unclassified file) are ignored — layering only governs files the
 * policy author opted into.
 */

import path from 'node:path';
import { minimatch } from 'minimatch';
import type {
  ArchitectureCheckContext,
  ArchitectureCheckFn,
  PolicyDiagnosticLocation,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';

/**
 * Per-layer configuration.
 *
 * - `files`: glob patterns (relative to the policy `cwd`) selecting the
 *   files that belong to this layer.
 * - `allows`: optional whitelist of other layer names this layer may
 *   import from. When present, any cross-layer edge to a layer not in
 *   the list is reported. The layer's own files are always allowed to
 *   import each other regardless of `allows`.
 * - `denies`: optional blacklist of other layer names this layer must
 *   not import from. `denies` is checked in addition to `allows`; an
 *   edge is allowed only when it satisfies both constraints.
 */
export type NoLayerViolationLayerConfig = {
  files: string[];
  allows?: string[];
  denies?: string[];
};

/**
 * Configurable arguments for the `no-layer-violation` architecture
 * rule.
 *
 * - `layers`: map from layer name to {@link NoLayerViolationLayerConfig}.
 *   At least one layer must declare `allows` or `denies` for the rule to
 *   produce any output.
 */
export type NoLayerViolationArgs = {
  layers?: Record<string, NoLayerViolationLayerConfig>;
};

type LayerEntry = {
  name: string;
  config: NoLayerViolationLayerConfig;
};

type FileLayerAssignment = {
  layer: string;
  matchedGlob: string;
  /**
   * Other layers whose globs also matched this file. Non-empty when
   * the assignment is ambiguous (a config error).
   */
  ambiguousWith: Array<{ layer: string; matchedGlob: string }>;
};

function relativePath(cwd: string, file: string): string {
  return path.relative(cwd, file);
}

function globMatches(pattern: string, relative: string): boolean {
  return minimatch(relative, pattern, { dot: true });
}

/**
 * Pick the most-specific glob that matched a file. "Most specific" is
 * approximated as the longest pattern; ties stay tied so the caller can
 * surface them as a config error.
 */
function bestMatchingGlobChoose(
  patterns: string[],
  relative: string,
): { glob: string; tied: string[] } | undefined {
  let best: string | undefined;
  let bestLen = -1;
  let tied: string[] = [];
  for (const pattern of patterns) {
    if (!globMatches(pattern, relative)) continue;
    if (pattern.length > bestLen) {
      best = pattern;
      bestLen = pattern.length;
      tied = [pattern];
    } else if (pattern.length === bestLen) {
      tied.push(pattern);
    }
  }
  if (best === undefined) return undefined;
  return { glob: best, tied: tied.length > 1 ? tied : [] };
}

function fileLayerAssign(
  file: string,
  cwd: string,
  layers: LayerEntry[],
): FileLayerAssignment | undefined {
  const relative = relativePath(cwd, file);
  type Hit = { name: string; matchedGlob: string };
  const hits: Hit[] = [];
  for (const layer of layers) {
    const match = bestMatchingGlobChoose(layer.config.files, relative);
    if (!match) continue;
    hits.push({ name: layer.name, matchedGlob: match.glob });
  }
  if (hits.length === 0) return undefined;

  // Most specific layer is the one whose matched glob is longest.
  hits.sort((a, b) => b.matchedGlob.length - a.matchedGlob.length);
  const winner = hits[0]!;
  const ambiguousWith = hits
    .slice(1)
    .filter((hit) => hit.matchedGlob.length === winner.matchedGlob.length)
    .map((hit) => ({ layer: hit.name, matchedGlob: hit.matchedGlob }));

  return {
    layer: winner.name,
    matchedGlob: winner.matchedGlob,
    ambiguousWith,
  };
}

function edgeIsAllowed(
  fromLayer: string,
  toLayer: string,
  layerByName: Map<string, NoLayerViolationLayerConfig>,
): boolean {
  if (fromLayer === toLayer) return true;
  const config = layerByName.get(fromLayer);
  if (!config) return true;
  if (config.denies && config.denies.includes(toLayer)) return false;
  if (config.allows !== undefined) {
    return config.allows.includes(toLayer);
  }
  // No `allows` and no matching `denies` → silently permitted.
  return true;
}

/**
 * The check function.
 */
export const noLayerViolationCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  const args = (context.ruleArgs as NoLayerViolationArgs | undefined) ?? {};
  const layersConfig = args.layers ?? {};
  const layerEntries: LayerEntry[] = Object.entries(layersConfig).map(([name, config]) => ({
    name,
    config,
  }));
  if (layerEntries.length === 0) return [];

  const layerByName = new Map<string, NoLayerViolationLayerConfig>(
    layerEntries.map((layer) => [layer.name, layer.config]),
  );

  const ruleId = rule.id || rule.ruleId;
  const violations: PolicyViolation[] = [];

  // Classify every file we know about. Files are pulled from the
  // project index because architecture rules don't have a per-file
  // target loop — they operate on the whole graph.
  const allFiles = context.projectIndex.filesGet();
  const fileLayer = new Map<string, FileLayerAssignment>();
  for (const file of allFiles) {
    const assignment = fileLayerAssign(file, context.cwd, layerEntries);
    if (!assignment) continue;
    fileLayer.set(file, assignment);

    if (assignment.ambiguousWith.length > 0) {
      const conflictingLayers = assignment.ambiguousWith.map((h) => h.layer).join(', ');
      violations.push({
        ruleId,
        filePath: file,
        message: `Layer assignment is ambiguous: matches both '${assignment.layer}' and ${conflictingLayers}. Make one glob more specific.`,
        line: 1,
        column: 1,
      });
    }
  }

  // Walk every classified file's importees. We use the module graph
  // adjacency directly so that the violations align with what the
  // dependency-graph view would render.
  for (const [fromFile, fromAssignment] of fileLayer) {
    const importees = context.moduleGraph.moduleGraphImporteesGet(fromFile);
    for (const toFile of importees) {
      const toAssignment = fileLayer.get(toFile);
      if (!toAssignment) continue; // Edge to unclassified file is ignored.
      if (edgeIsAllowed(fromAssignment.layer, toAssignment.layer, layerByName)) continue;

      const related: PolicyDiagnosticLocation[] = [
        {
          filePath: toFile,
          line: 1,
          column: 1,
          message: `imported file (layer '${toAssignment.layer}')`,
        },
      ];
      violations.push({
        ruleId,
        filePath: fromFile,
        message: `Layer '${fromAssignment.layer}' is not allowed to import from layer '${toAssignment.layer}'.`,
        line: 1,
        column: 1,
        relatedLocations: related,
      });
    }
  }

  return violations;
};

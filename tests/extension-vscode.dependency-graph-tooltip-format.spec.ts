import { describe, expect, it } from 'vitest';
import {
  dependencyGraphEdgeTooltipFormat,
  dependencyGraphNodeTooltipFormat,
} from '../extension-vscode/src/viewModels';

describe('dependencyGraphNodeTooltipFormat', () => {
  it('returns undefined when the node has no metrics, package, or layer', () => {
    expect(
      dependencyGraphNodeTooltipFormat({
        uri: 'file:///workspace/src/a.ts',
        workspaceRelativePath: 'src/a.ts',
      }),
    ).toBeUndefined();
  });

  it('uses singular nouns when counts equal 1', () => {
    expect(
      dependencyGraphNodeTooltipFormat({
        uri: 'file:///workspace/src/a.ts',
        workspaceRelativePath: 'src/a.ts',
        metrics: {
          importerCount: 1,
          importeeCount: 1,
          symbolCount: 1,
          isEntryPoint: false,
          isInCycle: false,
        },
      }),
    ).toBe('1 importer · 1 importee · 1 symbol');
  });

  it('uses plural nouns for zero and N>1 counts', () => {
    expect(
      dependencyGraphNodeTooltipFormat({
        uri: 'file:///workspace/src/a.ts',
        workspaceRelativePath: 'src/a.ts',
        metrics: {
          importerCount: 0,
          importeeCount: 5,
          symbolCount: 12,
          isEntryPoint: true,
          isInCycle: false,
        },
      }),
    ).toBe('0 importers · 5 importees · 12 symbols');
  });

  it('omits LOC when metrics.loc is undefined', () => {
    const tooltip = dependencyGraphNodeTooltipFormat({
      uri: 'file:///workspace/src/a.ts',
      workspaceRelativePath: 'src/a.ts',
      metrics: {
        importerCount: 2,
        importeeCount: 1,
        symbolCount: 4,
        aggregateCyclomaticComplexity: 3,
        isEntryPoint: false,
        isInCycle: false,
      },
    });
    expect(tooltip).toBe('2 importers · 1 importee · 4 symbols · cyc 3');
    expect(tooltip).not.toContain('LOC');
  });

  it('omits cyclomatic complexity when undefined', () => {
    const tooltip = dependencyGraphNodeTooltipFormat({
      uri: 'file:///workspace/src/a.ts',
      workspaceRelativePath: 'src/a.ts',
      metrics: {
        importerCount: 2,
        importeeCount: 1,
        symbolCount: 4,
        loc: 50,
        isEntryPoint: false,
        isInCycle: false,
      },
    });
    expect(tooltip).toBe('2 importers · 1 importee · 4 symbols · 50 LOC');
    expect(tooltip).not.toContain('cyc');
  });

  it('returns just the package name when no metrics are present', () => {
    expect(
      dependencyGraphNodeTooltipFormat({
        uri: 'file:///workspace/packages/lib/src/index.ts',
        workspaceRelativePath: 'packages/lib/src/index.ts',
        packageName: '@acme/lib',
      }),
    ).toBe('@acme/lib');
  });

  it('returns just the layer label when only layer is set', () => {
    expect(
      dependencyGraphNodeTooltipFormat({
        uri: 'file:///workspace/src/domain/user.ts',
        workspaceRelativePath: 'src/domain/user.ts',
        layer: 'domain',
      }),
    ).toBe('layer: domain');
  });

  it('joins package and layer into the trailing tail when both present', () => {
    expect(
      dependencyGraphNodeTooltipFormat({
        uri: 'file:///workspace/packages/lib/src/index.ts',
        workspaceRelativePath: 'packages/lib/src/index.ts',
        packageName: '@acme/lib',
        layer: 'domain',
      }),
    ).toBe('@acme/lib · layer: domain');
  });

  it('appends package and layer after the metrics line when all are present', () => {
    expect(
      dependencyGraphNodeTooltipFormat({
        uri: 'file:///workspace/packages/lib/src/index.ts',
        workspaceRelativePath: 'packages/lib/src/index.ts',
        packageName: '@acme/lib',
        layer: 'domain',
        metrics: {
          importerCount: 3,
          importeeCount: 1,
          symbolCount: 12,
          loc: 84,
          aggregateCyclomaticComplexity: 7,
          isEntryPoint: false,
          isInCycle: false,
        },
      }),
    ).toBe(
      '3 importers · 1 importee · 12 symbols · 84 LOC · cyc 7 · @acme/lib · layer: domain',
    );
  });
});

describe('dependencyGraphEdgeTooltipFormat', () => {
  it('returns undefined for an edge with no enrichment fields', () => {
    expect(
      dependencyGraphEdgeTooltipFormat({
        fromUri: 'a',
        toUri: 'b',
      }),
    ).toBeUndefined();
  });

  it('renders only the kind when no other fields are set', () => {
    expect(
      dependencyGraphEdgeTooltipFormat({
        fromUri: 'a',
        toUri: 'b',
        kind: 'static',
      }),
    ).toBe('static');
  });

  it('falls back to "import" prefix when bindingCount is set without a kind', () => {
    expect(
      dependencyGraphEdgeTooltipFormat({
        fromUri: 'a',
        toUri: 'b',
        bindingCount: 3,
      }),
    ).toBe('import · 3 bindings');
  });

  it('uses singular noun when bindingCount equals 1', () => {
    expect(
      dependencyGraphEdgeTooltipFormat({
        fromUri: 'a',
        toUri: 'b',
        kind: 'cjs',
        bindingCount: 1,
      }),
    ).toBe('cjs · 1 binding');
  });

  it('uses plural noun for 0 and N>1 bindings', () => {
    expect(
      dependencyGraphEdgeTooltipFormat({
        fromUri: 'a',
        toUri: 'b',
        kind: 'side_effect',
        bindingCount: 0,
      }),
    ).toBe('side_effect · 0 bindings');
  });

  it('omits cross flags when explicitly false', () => {
    expect(
      dependencyGraphEdgeTooltipFormat({
        fromUri: 'a',
        toUri: 'b',
        kind: 'static',
        bindingCount: 2,
        crossesPackageBoundary: false,
        crossesLayerBoundary: false,
      }),
    ).toBe('static · 2 bindings');
  });

  it('appends cross-layer when crossesLayerBoundary is true', () => {
    expect(
      dependencyGraphEdgeTooltipFormat({
        fromUri: 'a',
        toUri: 'b',
        kind: 'static',
        bindingCount: 2,
        crossesLayerBoundary: true,
      }),
    ).toBe('static · 2 bindings · cross-layer');
  });

  it('joins both crosses in the conventional package-then-layer order', () => {
    expect(
      dependencyGraphEdgeTooltipFormat({
        fromUri: 'a',
        toUri: 'b',
        kind: 'dynamic',
        bindingCount: 4,
        crossesPackageBoundary: true,
        crossesLayerBoundary: true,
      }),
    ).toBe('dynamic · 4 bindings · cross-package · cross-layer');
  });
});

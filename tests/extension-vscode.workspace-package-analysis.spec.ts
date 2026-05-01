import { describe, expect, it } from 'vitest';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';
import { workspacePackageGraphAnalysisCreate } from '../extension-vscode/src/workspacePackageAnalysis';

describe('extension-vscode workspace package analysis', () => {
  it('aggregates package hierarchy and cross-package dependencies from the graph', () => {
    const graph: WorkspaceDependencyGraphResult = {
      nodes: [
        {
          uri: 'file:///workspace/packages/lib/src/index.ts',
          workspaceRelativePath: 'packages/lib/src/index.ts',
          packageName: '@acme/lib',
          metrics: {
            importerCount: 1,
            importeeCount: 2,
            symbolCount: 4,
            isEntryPoint: true,
            isInCycle: false,
            loc: 40,
          },
        },
        {
          uri: 'file:///workspace/packages/lib/src/feature.ts',
          workspaceRelativePath: 'packages/lib/src/feature.ts',
          packageName: '@acme/lib',
          metrics: {
            importerCount: 0,
            importeeCount: 1,
            symbolCount: 6,
            isEntryPoint: false,
            isInCycle: true,
            loc: 60,
          },
        },
        {
          uri: 'file:///workspace/packages/core/src/index.ts',
          workspaceRelativePath: 'packages/core/src/index.ts',
          packageName: '@acme/core',
          metrics: {
            importerCount: 2,
            importeeCount: 0,
            symbolCount: 2,
            isEntryPoint: false,
            isInCycle: false,
          },
        },
        {
          uri: 'file:///workspace/packages/app/src/index.ts',
          workspaceRelativePath: 'packages/app/src/index.ts',
          packageName: '@acme/app',
          metrics: {
            importerCount: 0,
            importeeCount: 1,
            symbolCount: 3,
            isEntryPoint: false,
            isInCycle: false,
          },
        },
      ],
      edges: [
        {
          fromUri: 'file:///workspace/packages/lib/src/index.ts',
          toUri: 'file:///workspace/packages/core/src/index.ts',
        },
        {
          fromUri: 'file:///workspace/packages/lib/src/feature.ts',
          toUri: 'file:///workspace/packages/core/src/index.ts',
        },
        {
          fromUri: 'file:///workspace/packages/app/src/index.ts',
          toUri: 'file:///workspace/packages/lib/src/index.ts',
        },
      ],
      entryPoints: ['file:///workspace/packages/lib/src/index.ts'],
      cycles: [['file:///workspace/packages/lib/src/feature.ts']],
    };

    const analysis = workspacePackageGraphAnalysisCreate('@acme/lib', graph);

    expect(analysis.hierarchy).toEqual({
      status: 'ready',
      moduleCount: 2,
      symbolCount: 10,
      entryPointCount: 1,
      cycleFileCount: 1,
      loc: 100,
    });
    expect(analysis.dependencies).toEqual({
      status: 'ready',
      dependsOn: [
        {
          packageName: '@acme/core',
          edgeCount: 2,
          fileCount: 1,
        },
      ],
      usedBy: [
        {
          packageName: '@acme/app',
          edgeCount: 1,
          fileCount: 1,
        },
      ],
    });
  });

  it('returns explicit unavailable states when the graph is missing', () => {
    const analysis = workspacePackageGraphAnalysisCreate('@acme/lib', null);

    expect(analysis.hierarchy).toMatchObject({
      status: 'unavailable',
    });
    expect(analysis.dependencies).toMatchObject({
      status: 'unavailable',
    });
  });
});

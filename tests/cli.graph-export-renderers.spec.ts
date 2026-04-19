/**
 * Pure-function tests for the `codepol graph export --format` renderers.
 *
 * The integration suite (`tests/e2e.cli.graph.spec.ts`) covers the
 * end-to-end CLI dispatch. These cases lock in the structural details of
 * the dot, mermaid, and graphml outputs so external tools (Graphviz,
 * Mermaid Live Editor, Gephi) can keep parsing them without surprises.
 */
import { describe, expect, it } from 'vitest';
import type { WorkspaceDependencyGraphResult } from '@codepol/core';
import {
  graphExportFormatChoices,
  graphExportFormatParse,
  graphExportRenderDot,
  graphExportRenderGraphMl,
  graphExportRenderMermaid,
} from '../apps/cli/src/graph/graphExportRenderers';

function fixtureGraphCreate(): WorkspaceDependencyGraphResult {
  return {
    nodes: [
      // Intentionally unsorted to exercise renderer-side normalization.
      { uri: 'file:///root/src/b.ts', workspaceRelativePath: 'src/b.ts' },
      { uri: 'file:///root/src/a.ts', workspaceRelativePath: 'src/a.ts' },
      {
        uri: 'file:///root/src/quotes "and".ts',
        workspaceRelativePath: 'src/quotes "and".ts',
      },
    ],
    edges: [
      { fromUri: 'file:///root/src/a.ts', toUri: 'file:///root/src/b.ts' },
      {
        fromUri: 'file:///root/src/b.ts',
        toUri: 'file:///root/src/quotes "and".ts',
      },
    ],
    entryPoints: ['file:///root/src/a.ts'],
    cycles: [],
  };
}

describe('graphExportFormatParse', () => {
  it('lists the public format choices', () => {
    expect(graphExportFormatChoices()).toEqual([
      'json',
      'text',
      'dot',
      'mermaid',
      'graphml',
    ]);
  });

  it('defaults to json when undefined', () => {
    expect(graphExportFormatParse(undefined)).toBe('json');
  });

  it('accepts mixed-case values', () => {
    expect(graphExportFormatParse('DOT')).toBe('dot');
    expect(graphExportFormatParse('Mermaid')).toBe('mermaid');
  });

  it('throws on unknown values with a helpful message', () => {
    expect(() => graphExportFormatParse('svg')).toThrow(/svg/);
    expect(() => graphExportFormatParse('svg')).toThrow(/json, text, dot, mermaid, graphml/);
  });
});

describe('graphExportRenderDot', () => {
  it('emits a deterministic Graphviz-compatible payload', () => {
    const dot = graphExportRenderDot(fixtureGraphCreate());
    expect(dot).toBe(
      [
        'digraph codepol {',
        '  rankdir=LR;',
        '  node [shape=box, fontname="Helvetica"];',
        '  n0 [label="src/a.ts"];',
        '  n1 [label="src/b.ts"];',
        '  n2 [label="src/quotes \\"and\\".ts"];',
        '  n0 -> n1;',
        '  n1 -> n2;',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('drops edges whose endpoints are not present in the node set', () => {
    const dot = graphExportRenderDot({
      nodes: [{ uri: 'file:///x.ts', workspaceRelativePath: 'x.ts' }],
      edges: [{ fromUri: 'file:///x.ts', toUri: 'file:///missing.ts' }],
      entryPoints: [],
      cycles: [],
    });
    expect(dot).toContain('n0 [label="x.ts"];');
    expect(dot).not.toContain('->');
  });
});

describe('graphExportRenderMermaid', () => {
  it('emits a flowchart with stable ids and quoted labels', () => {
    const mermaid = graphExportRenderMermaid(fixtureGraphCreate());
    expect(mermaid).toBe(
      [
        'flowchart LR',
        '  n0["src/a.ts"]',
        '  n1["src/b.ts"]',
        '  n2["src/quotes \\"and\\".ts"]',
        '  n0 --> n1',
        '  n1 --> n2',
        '',
      ].join('\n'),
    );
  });
});

describe('graphExportRenderGraphMl', () => {
  it('emits a GraphML document with escaped attributes and stable edge ids', () => {
    const graphml = graphExportRenderGraphMl(fixtureGraphCreate());
    expect(graphml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(graphml).toContain('<graph id="codepol" edgedefault="directed">');
    expect(graphml).toContain(
      '<data key="label">src/quotes &quot;and&quot;.ts</data>',
    );
    expect(graphml).toContain(
      '<data key="uri">file:///root/src/quotes &quot;and&quot;.ts</data>',
    );
    expect(graphml).toMatch(/<edge id="e0" source="n0" target="n1"\/>/);
    expect(graphml).toMatch(/<edge id="e1" source="n1" target="n2"\/>/);
    expect(graphml.trimEnd().endsWith('</graphml>')).toBe(true);
  });

  it('escapes &, <, > in both label and uri attributes', () => {
    const graphml = graphExportRenderGraphMl({
      nodes: [
        {
          uri: 'file:///root/a&b.ts',
          workspaceRelativePath: 'src/<Component>.ts',
        },
      ],
      edges: [],
      entryPoints: [],
      cycles: [],
    });
    // Raw `<`, `>`, `&` must never reach the document body — they would
    // corrupt the XML for downstream parsers (yEd, Gephi, igraph).
    expect(graphml).toContain('<data key="label">src/&lt;Component&gt;.ts</data>');
    expect(graphml).toContain('<data key="uri">file:///root/a&amp;b.ts</data>');
    // The path content itself appears nowhere unescaped:
    expect(graphml).not.toContain('src/<Component>.ts');
    expect(graphml).not.toContain('a&b.ts');
  });
});

describe('renderer edge cases shared by every format', () => {
  const emptyGraph: WorkspaceDependencyGraphResult = {
    nodes: [],
    edges: [],
    entryPoints: [],
    cycles: [],
  };

  it('renders an empty graph as a valid (but empty) document for every format', () => {
    const dot = graphExportRenderDot(emptyGraph);
    expect(dot).toBe(
      [
        'digraph codepol {',
        '  rankdir=LR;',
        '  node [shape=box, fontname="Helvetica"];',
        '}',
        '',
      ].join('\n'),
    );

    const mermaid = graphExportRenderMermaid(emptyGraph);
    expect(mermaid).toBe('flowchart LR\n');

    const graphml = graphExportRenderGraphMl(emptyGraph);
    expect(graphml).toContain('<graph id="codepol" edgedefault="directed">');
    expect(graphml).toContain('</graph>');
    // No `<node>` / `<edge>` tags when the input is empty.
    expect(graphml).not.toContain('<node ');
    expect(graphml).not.toContain('<edge ');
  });

  const cyclicGraph: WorkspaceDependencyGraphResult = {
    nodes: [
      { uri: 'file:///root/a.ts', workspaceRelativePath: 'a.ts' },
      { uri: 'file:///root/b.ts', workspaceRelativePath: 'b.ts' },
      { uri: 'file:///root/c.ts', workspaceRelativePath: 'c.ts' },
    ],
    edges: [
      { fromUri: 'file:///root/a.ts', toUri: 'file:///root/b.ts' },
      { fromUri: 'file:///root/b.ts', toUri: 'file:///root/c.ts' },
      { fromUri: 'file:///root/c.ts', toUri: 'file:///root/a.ts' },
    ],
    entryPoints: [],
    cycles: [
      ['file:///root/a.ts', 'file:///root/b.ts', 'file:///root/c.ts'],
    ],
  };

  it('preserves the cycle back-edge after deterministic sorting in every format', () => {
    expect(graphExportRenderDot(cyclicGraph)).toContain('n2 -> n0;');
    expect(graphExportRenderMermaid(cyclicGraph)).toContain('n2 --> n0');
    expect(graphExportRenderGraphMl(cyclicGraph)).toContain(
      '<edge id="e2" source="n2" target="n0"/>',
    );
  });
});

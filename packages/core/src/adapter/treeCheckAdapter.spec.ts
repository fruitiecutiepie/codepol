import type { SyntaxNode } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  violationToLintDiagnostic,
  violationsToLintDiagnostics,
  treeSitterViolationPositionPreferred,
} from './treeCheckAdapter';
import type { PolicyViolation } from '../policy/policyTypes';
import { langAdd } from '../parser/parserLangs';
import { parserGetForFile, parserInit } from '../parser/parserInit';

function syntaxNodeFindFirst(
  node: SyntaxNode,
  type: string,
): SyntaxNode | undefined {
  if (node.type === type) {
    return node;
  }
  for (const child of node.namedChildren) {
    const found = syntaxNodeFindFirst(child, type);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe('treeSitterViolationPositionPreferred', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('points at function name, not the function keyword', () => {
    const source = 'export function myFunc() {\n  return 1;\n}\n';
    const parser = parserGetForFile('x.ts');
    if ('Err' in parser) {
      throw new Error(String(parser.Err));
    }
    const tree = parser.Ok.parse(source);
    const fn = syntaxNodeFindFirst(tree.rootNode, 'function_declaration');
    expect(fn).toBeDefined();
    const pos = treeSitterViolationPositionPreferred(fn!);
    const nameLine = source.slice(0, source.indexOf('myFunc')).split('\n').length;
    const nameCol =
      source.split('\n')[nameLine - 1]!.indexOf('myFunc') + 1;
    expect(pos.line).toBe(nameLine);
    expect(pos.column).toBe(nameCol);
  });

  it('points at const binding for arrow function without name', () => {
    const source = 'const arrowFn = () => 1;\n';
    const parser = parserGetForFile('x.ts');
    if ('Err' in parser) {
      throw new Error(String(parser.Err));
    }
    const tree = parser.Ok.parse(source);
    const decl = syntaxNodeFindFirst(tree.rootNode, 'variable_declarator');
    expect(decl?.type).toBe('variable_declarator');
    const arrowFn = decl?.namedChildren.find((n) => n.type === 'arrow_function');
    expect(arrowFn).toBeDefined();
    const pos = treeSitterViolationPositionPreferred(arrowFn!);
    expect(pos.line).toBe(1);
    expect(pos.column).toBe(source.indexOf('arrowFn') + 1);
  });
});

describe('treeCheckAdapter', () => {
  const baseViolation: PolicyViolation = {
    ruleId: 'require-logger',
    filePath: '/src/foo.ts',
    message: 'Missing logger.enter()',
    line: 10,
    column: 5,
  };

  describe('violationToLintDiagnostic', () => {
    it('should map all fields correctly with default severity', () => {
      const diagnostic = violationToLintDiagnostic(baseViolation);

      expect(diagnostic.message).toBe('Missing logger.enter()');
      expect(diagnostic.line).toBe(10);
      expect(diagnostic.column).toBe(5);
      expect(diagnostic.ruleId).toBe('require-logger');
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.fix).toBeUndefined();
    });

    it('should use custom severity when provided', () => {
      const diagnostic = violationToLintDiagnostic(baseViolation, 'warning');
      expect(diagnostic.severity).toBe('warning');

      const infoDiagnostic = violationToLintDiagnostic(baseViolation, 'info');
      expect(infoDiagnostic.severity).toBe('info');
    });

    it('should pass through fix data when present', () => {
      const violationWithFix: PolicyViolation = {
        ...baseViolation,
        fix: { byteRange: { start: 100, end: 110 }, text: 'logger.enter();' },
      };

      const diagnostic = violationToLintDiagnostic(violationWithFix);

      expect(diagnostic.fix).toEqual(
        { byteRange: { start: 100, end: 110 }, text: 'logger.enter();' }
      );
    });
  });

  describe('violationsToLintDiagnostics', () => {
    it('should return empty array for empty input', () => {
      const diagnostics = violationsToLintDiagnostics([]);
      expect(diagnostics).toEqual([]);
    });

    it('should map each violation to a diagnostic', () => {
      const violations: PolicyViolation[] = [
        baseViolation,
        {
          ruleId: 'no-console',
          filePath: '/src/bar.ts',
          message: 'Unexpected console.log',
          line: 20,
          column: 3,
        },
      ];

      const diagnostics = violationsToLintDiagnostics(violations);

      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0].ruleId).toBe('require-logger');
      expect(diagnostics[0].severity).toBe('error');
      expect(diagnostics[1].ruleId).toBe('no-console');
      expect(diagnostics[1].message).toBe('Unexpected console.log');
    });

    it('should apply custom severity to all diagnostics', () => {
      const violations: PolicyViolation[] = [baseViolation, baseViolation];

      const diagnostics = violationsToLintDiagnostics(violations, 'warning');

      for (const d of diagnostics) {
        expect(d.severity).toBe('warning');
      }
    });
  });
});

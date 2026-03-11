import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
} from '@codepol/core';
import { identifierSplitByCasing } from './lib/identifierSplitByCasing';

type ForbiddenWordsArgs = {
  words: string[];
};

type IdentifierMatch = {
  name: string;
  line: number;
  column: number;
};

const JS_TS_PATTERNS: RegExp[] = [
  /\bfunction\s+(\w+)/g,
  /\b(?:const|let|var)\s+(\w+)/g,
  /\b(?:type|interface|class|enum)\s+(\w+)/g,
];

const PYTHON_PATTERNS: RegExp[] = [
  /\bdef\s+(\w+)/g,
  /\bclass\s+(\w+)/g,
  /^(\w+)\s*(?::\s*\w[^\n]*)?\s*=/gm,
];

function patternsForFile(filePath: string): RegExp[] {
  return filePath.endsWith('.py') ? PYTHON_PATTERNS : JS_TS_PATTERNS;
}

function extractIdentifiers(
  source: string,
  filePath: string
): IdentifierMatch[] {
  const matches: IdentifierMatch[] = [];
  const lines = source.split('\n');
  const patterns = patternsForFile(filePath);

  lines.forEach((line, lineIndex) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(line)) !== null) {
        const identifierName = match[1];
        const identifierStart = match.index + match[0].indexOf(identifierName);

        matches.push({
          name: identifierName,
          line: lineIndex + 1,
          column: identifierStart + 1,
        });
      }
    }
  });

  return matches;
}

function containsForbiddenWord(
  identifier: string,
  forbiddenWords: string[]
): string | null {
  const segments = identifierSplitByCasing(identifier);

  for (const word of forbiddenWords) {
    if (segments.includes(word.toLowerCase())) {
      return word;
    }
  }

  return null;
}

export function forbiddenWordsCheck(
  rule: PolicyRule,
  context: PolicyCheckContext
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const args = context.ruleArgs as ForbiddenWordsArgs | undefined;

  if (!args?.words || args.words.length === 0) {
    return violations;
  }

  const identifiers = extractIdentifiers(context.source, context.filePath);

  for (const identifier of identifiers) {
    const matchedWord = containsForbiddenWord(identifier.name, args.words);

    if (matchedWord) {
      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath: context.filePath,
        message: `Identifier '${identifier.name}' contains forbidden word '${matchedWord}'`,
        line: identifier.line,
        column: identifier.column,
      });
    }
  }

  return violations;
}

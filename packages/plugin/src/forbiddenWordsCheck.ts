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

const IDENTIFIER_PATTERNS: RegExp[] = [
  /\bfunction\s+(\w+)/g,                    // function declarations
  /\b(?:const|let|var)\s+(\w+)/g,           // variable declarations
  /\b(?:type|interface|class|enum)\s+(\w+)/g, // type declarations
];

function extractIdentifiers(source: string): IdentifierMatch[] {
  const matches: IdentifierMatch[] = [];
  const lines = source.split('\n');

  lines.forEach((line, lineIndex) => {
    for (const pattern of IDENTIFIER_PATTERNS) {
      // Reset regex state for each line
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(line)) !== null) {
        const identifierName = match[1];
        // Column is the position of the identifier itself, not the keyword
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

  const identifiers = extractIdentifiers(context.source);

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

const a = 'b';
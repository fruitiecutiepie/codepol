import path from 'node:path';
import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
} from '@codepol/core';
import { identifierSplitByCasing } from './lib/identifierSplitByCasing';

export type ForbiddenPathWordsArgs = {
  words: string[];
  checkFiles?: boolean;       // default: true
  checkDirectories?: boolean; // default: true
  ignoreExtensions?: boolean; // default: true
};

type PathSegment = {
  value: string;
  kind: 'file' | 'directory';
};

function pathSegmentsExtract(filePath: string, cwd: string): PathSegment[] {
  const relativePath = path.relative(cwd, filePath);
  const rawSegments = relativePath.split(/[\\/]+/).filter(Boolean);

  if (rawSegments.length === 0) {
    return [];
  }

  const fileSegment = rawSegments[rawSegments.length - 1];
  if (!fileSegment) {
    return [];
  }

  const directories = rawSegments.slice(0, -1).map((segment) => ({
    value: segment,
    kind: 'directory' as const,
  }));

  return [...directories, { value: fileSegment, kind: 'file' as const }];
}

function pathSegmentContainsForbiddenWord(
  segment: string,
  forbiddenWords: string[],
  includeExtension: boolean = false
): string | null {
  // Split on dots first if we're including extensions, then apply casing split
  const parts = includeExtension ? segment.split('.') : [segment];
  const words = parts.flatMap((part) => identifierSplitByCasing(part));

  for (const forbidden of forbiddenWords) {
    if (words.includes(forbidden.toLowerCase())) {
      return forbidden;
    }
  }

  return null;
}

export function forbiddenPathWordsCheck(
  rule: PolicyRule,
  context: PolicyCheckContext
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const args = context.ruleArgs as ForbiddenPathWordsArgs | undefined;

  if (!args?.words || args.words.length === 0) {
    return violations;
  }

  const checkFiles = args.checkFiles ?? true;
  const checkDirectories = args.checkDirectories ?? true;
  const ignoreExtensions = args.ignoreExtensions ?? true;

  const segments = pathSegmentsExtract(context.filePath, context.dir);

  for (const segment of segments) {
    if (segment.kind === 'file' && !checkFiles) {
      continue;
    }
    if (segment.kind === 'directory' && !checkDirectories) {
      continue;
    }

    const segmentName =
      segment.kind === 'file' && ignoreExtensions
        ? path.parse(segment.value).name
        : segment.value;

    if (!segmentName) {
      continue;
    }

    // When ignoreExtensions is false and this is a file, include the extension in checking
    const includeExtension = segment.kind === 'file' && !ignoreExtensions;
    const matchedWord = pathSegmentContainsForbiddenWord(
      includeExtension ? segment.value : segmentName,
      args.words,
      includeExtension
    );

    if (matchedWord) {
      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath: context.filePath,
        message: `${segment.kind === 'file' ? 'File' : 'Directory'} name '${segmentName}' contains forbidden word '${matchedWord}'`,
        line: 1,
        column: 1,
      });
    }
  }

  return violations;
}

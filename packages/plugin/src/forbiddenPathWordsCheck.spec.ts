import { describe, it, expect } from 'vitest';
import { forbiddenPathWordsCheck } from './forbiddenPathWordsCheck';
import type { PolicyRule, PolicyCheckContext } from '@codepol/core';

describe('forbiddenPathWordsCheck', () => {
  const createContext = (
    filePath: string,
    args?: Record<string, unknown>
  ): PolicyCheckContext => ({
    filePath,
    source: '',
    policy: {
      plugins: [],
      rules: [],
      exclude: [],
      targets: { ts: { language: 'typescript', files: ['**/*.ts'] } },
    },
    dir: '/project',
    target: { language: 'typescript', files: ['**/*.ts'] },
    ruleArgs: args ?? { words: ['tmp', 'old', 'wip'] },
  });

  const rule: PolicyRule = {
    id: 'test-rule',
    ruleId: 'forbidden-path-words',
    targets: ['ts'],
  };

  describe('file name checking', () => {
    it('flags file with forbidden word in camelCase', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/oldButton.ts')
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('oldButton');
      expect(violations[0].message).toContain('old');
      expect(violations[0].message).toContain('File');
    });

    it('flags file with forbidden word in kebab-case', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/old-button.ts')
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('old-button');
      expect(violations[0].message).toContain('old');
    });

    it('flags file with forbidden word in snake_case', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/old_button.ts')
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('old_button');
      expect(violations[0].message).toContain('old');
    });

    it('allows files without forbidden words', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/userService.ts')
      );

      expect(violations).toHaveLength(0);
    });

    it('allows compound words containing forbidden word substring', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/template.ts')
      );

      expect(violations).toHaveLength(0);
    });
  });

  describe('directory name checking', () => {
    it('flags directory with forbidden word', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/tmp/file.ts')
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('tmp');
      expect(violations[0].message).toContain('Directory');
    });

    it('flags nested directory with forbidden word', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/old-components/button.ts')
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('old-components');
      expect(violations[0].message).toContain('old');
    });

    it('flags multiple directories with forbidden words', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/tmp/old-stuff/file.ts')
      );

      expect(violations).toHaveLength(2);
    });
  });

  describe('ignoreExtensions option', () => {
    it('ignores extension by default', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/button.ts', { words: ['ts'] })
      );

      expect(violations).toHaveLength(0);
    });

    it('checks extension when ignoreExtensions is false', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/button.ts', {
          words: ['ts'],
          ignoreExtensions: false,
        })
      );

      expect(violations).toHaveLength(1);
    });
  });

  describe('checkFiles option', () => {
    it('skips file checking when checkFiles is false', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/oldButton.ts', {
          words: ['old'],
          checkFiles: false,
        })
      );

      expect(violations).toHaveLength(0);
    });

    it('still checks directories when checkFiles is false', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/old/button.ts', {
          words: ['old'],
          checkFiles: false,
        })
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('Directory');
    });
  });

  describe('checkDirectories option', () => {
    it('skips directory checking when checkDirectories is false', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/tmp/button.ts', {
          words: ['tmp'],
          checkDirectories: false,
        })
      );

      expect(violations).toHaveLength(0);
    });

    it('still checks files when checkDirectories is false', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/src/tmpButton.ts', {
          words: ['tmp'],
          checkDirectories: false,
        })
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('File');
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no args provided', () => {
      const context = createContext('/project/tmp/old.ts');
      context.ruleArgs = undefined;

      const violations = forbiddenPathWordsCheck(rule, context);
      expect(violations).toHaveLength(0);
    });

    it('returns empty array when words array is empty', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/tmp/old.ts', { words: [] })
      );

      expect(violations).toHaveLength(0);
    });

    it('reports line 1, column 1 for path violations', () => {
      const violations = forbiddenPathWordsCheck(
        rule,
        createContext('/project/tmp/file.ts')
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(1);
      expect(violations[0].column).toBe(1);
    });

    it('includes correct filePath in violation', () => {
      const filePath = '/project/tmp/file.ts';
      const violations = forbiddenPathWordsCheck(rule, createContext(filePath));

      expect(violations[0].filePath).toBe(filePath);
    });
  });
});

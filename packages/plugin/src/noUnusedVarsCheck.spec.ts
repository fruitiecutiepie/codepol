import { beforeAll, describe, expect, it } from 'vitest';
import {
  langAdd,
  parserInit,
  projectIndexBuildSync,
  type PolicyCheckContext,
  type PolicyRule,
  type ProjectIndex,
} from '@codepol/core';
import { noUnusedVarsCheck, type NoUnusedVarsArgs } from './noUnusedVarsCheck';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('noUnusedVarsCheck', () => {
  let testDir: string;

  function createContext(
    filePath: string,
    source: string,
    index: ProjectIndex,
    ruleArgs: NoUnusedVarsArgs = {},
  ): { rule: PolicyRule; context: PolicyCheckContext } {
    const rule: PolicyRule = {
      ruleId: 'no-unused-vars',
      description: 'Test rule',
      targets: [],
    };

    const target = {
      language: 'typescript' as const,
      files: ['**/*.ts'],
    };

    const policy = {
      targets: { ts: target },
      rules: [rule],
    };

    return {
      rule,
      context: {
        filePath,
        source,
        policy,
        dir: testDir,
        target,
        projectIndex: index,
        ruleArgs,
      },
    };
  }

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-no-unused-vars-'));
  });

  it('reports write-only locals, type-only locals, trailing args, and unused catch bindings', () => {
    const file = path.join(testDir, 'unused.ts');
    const source = `
export const exported = 1;

function demo(ignoredLeading, usedParam, unusedTrailing) {
  let writeOnly = 0;
  writeOnly = writeOnly + usedParam;
  const live = usedParam;
  const typeOnly = { value: live };
  type Alias = typeof typeOnly;

  try {
    doWork();
  } catch (err) {
    console.log(1);
  }

  return live;
}

demo(1, 2, 3);
`;

    fs.writeFileSync(file, source);

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const { rule, context } = createContext(file, source, index);
    const violations = noUnusedVarsCheck(rule, context);
    const messages = violations.map((violation) => violation.message);

    expect(messages).toContain(`'unusedTrailing' is defined but never used.`);
    expect(messages).toContain(`'writeOnly' is assigned a value but never used.`);
    expect(messages).toContain(`'typeOnly' is assigned a value but only used as a type.`);
    expect(messages).toContain(`'Alias' is defined but never used.`);
    expect(messages).toContain(`'err' is defined but never used.`);
    expect(messages.some((message) => message.includes('ignoredLeading'))).toBe(false);
    expect(messages.some((message) => message.includes('exported'))).toBe(false);
    expect(messages.some((message) => message.includes('live'))).toBe(false);
    expect(messages.some((message) => message.includes('demo'))).toBe(false);
  });

  it('honors ignore patterns, rest siblings, and reportUsedIgnorePattern', () => {
    const file = path.join(testDir, 'ignore-patterns.ts');
    const source = `
function demo(_unusedArg, ignoredUsedArg, data, items) {
  const { skipped, ...rest } = data;
  const [_slot, live] = items;

  console.log(rest, live, ignoredUsedArg);

  try {
    doWork();
  } catch (ignoredErr) {
    console.log(ignoredErr);
  }
}

demo(1, 2, obj, arr);
`;

    fs.writeFileSync(file, source);

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const { rule, context } = createContext(file, source, index, {
      args: 'all',
      argsIgnorePattern: '^(?:_|ignored)',
      caughtErrorsIgnorePattern: '^ignored',
      destructuredArrayIgnorePattern: '^_',
      ignoreRestSiblings: true,
      reportUsedIgnorePattern: true,
    });

    const violations = noUnusedVarsCheck(rule, context);
    const messages = violations.map((violation) => violation.message);

    expect(messages).toContain(`'ignoredUsedArg' is marked as ignored but is used. Used args must not match /^(?:_|ignored)/u.`);
    expect(messages).toContain(`'ignoredErr' is marked as ignored but is used. Used caught errors must not match /^ignored/u.`);
    expect(messages.some((message) => message.includes('_unusedArg'))).toBe(false);
    expect(messages.some((message) => message.includes('_slot'))).toBe(false);
    expect(messages.some((message) => message.includes('skipped'))).toBe(false);
  });

  it('treats object-literal shorthand properties as reads', () => {
    const file = path.join(testDir, 'object-shorthand.ts');
    const source = `
function demo() {
  const start = 1;
  const end = 2;
  const range = { start, end };
  return range;
}

demo();
`;

    fs.writeFileSync(file, source);

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const { rule, context } = createContext(file, source, index);
    const violations = noUnusedVarsCheck(rule, context);
    const messages = violations.map((violation) => violation.message);

    expect(messages.some((message) => message.includes(`'start'`))).toBe(false);
    expect(messages.some((message) => message.includes(`'end'`))).toBe(false);
    expect(messages.some((message) => message.includes(`'range'`))).toBe(false);
  });

  it('treats explicit object-literal property values as reads', () => {
    const file = path.join(testDir, 'object-pair.ts');
    const source = `
function noUnusedVarsCheck() {
  return 1;
}

function demo() {
  const config = {
    check: noUnusedVarsCheck,
  };
  return config.check();
}

demo();
`;

    fs.writeFileSync(file, source);

    const { index } = projectIndexBuildSync({ files: [file], dir: testDir });
    const { rule, context } = createContext(file, source, index);
    const violations = noUnusedVarsCheck(rule, context);
    const messages = violations.map((violation) => violation.message);

    expect(messages.some((message) => message.includes(`'noUnusedVarsCheck'`))).toBe(false);
    expect(messages.some((message) => message.includes(`'config'`))).toBe(false);
  });
});

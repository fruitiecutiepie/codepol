import { describe, expect, it } from 'vitest';
import {
  forbiddenDeclarationsCheck,
  type ForbiddenDeclarationsArgs,
} from './forbiddenDeclarationsCheck';
import type { PolicyCheckContext, PolicyRule } from '@codepol/core';

function createContext(
  source: string,
  ruleArgs?: ForbiddenDeclarationsArgs,
  filePath = 'test.ts',
): PolicyCheckContext {
  return {
    filePath,
    source,
    policy: {
      plugins: [],
      rules: [],
      exclude: [],
      targets: { ts: { language: 'typescript', files: ['**/*.ts'] } },
    },
    dir: '/test',
    target: { language: 'typescript', files: ['**/*.ts'] },
    ruleArgs,
  };
}

describe('forbiddenDeclarationsCheck', () => {
  const rule: PolicyRule = {
    id: 'forbidden-declarations',
    ruleId: 'forbidden-declarations',
    targets: ['ts'],
  };

  it.each([
    {
      label: 'namespace',
      source: 'namespace Foo {}',
      args: { symbols: ['namespace'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'Foo' (namespace).`,
    },
    {
      label: 'class',
      source: 'class Foo {}',
      args: { symbols: ['class'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'Foo' (class).`,
    },
    {
      label: 'interface',
      source: 'interface Foo {}',
      args: { symbols: ['interface'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'Foo' (interface).`,
    },
    {
      label: 'type',
      source: 'type Foo = string;',
      args: { symbols: ['type'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'Foo' (type).`,
    },
    {
      label: 'function',
      source: 'function run() {}',
      args: { symbols: ['function'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'run' (function).`,
    },
    {
      label: 'method',
      source: 'class Foo { run() {} }',
      args: { symbols: ['method'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'run' (method).`,
    },
    {
      label: 'field',
      source: 'class Foo { value = 1; }',
      args: { symbols: ['field'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'value' (field).`,
    },
    {
      label: 'const',
      source: 'const value = 1;',
      args: { symbols: ['const'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'value' (const).`,
    },
    {
      label: 'variable',
      source: 'let value = 1;',
      args: { symbols: ['variable'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'value' (variable).`,
    },
    {
      label: 'parameter',
      source: 'function run(arg: string) { return arg; }',
      args: { symbols: ['parameter'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'arg' (parameter).`,
    },
    {
      label: 'enum',
      source: 'enum Color { Red }',
      args: { symbols: ['enum'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'Color' (enum).`,
    },
    {
      label: 'enum member',
      source: 'enum Color { Red }',
      args: { symbols: ['enumMember'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'Red' (enum member).`,
    },
  ])('flags $label declarations', ({ source, args, expected }) => {
    const violations = forbiddenDeclarationsCheck(rule, createContext(source, args));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe(expected);
  });

  it('treats symbols.variable as local let/var only, excluding imports and catch bindings', () => {
    const source = `
import foo from './dep';

try {
  let localValue = 1;
  var legacyValue = 2;
} catch (err) {
  console.log(err);
}
`;

    const violations = forbiddenDeclarationsCheck(
      rule,
      createContext(source, { symbols: ['variable'] }),
    );

    expect(violations.map((violation) => violation.message)).toEqual([
      `Forbidden declaration 'localValue' (variable).`,
      `Forbidden declaration 'legacyValue' (variable).`,
    ]);
  });

  it('flags default, named, and namespace import bindings', () => {
    const source = `
import foo, { bar as baz } from './dep';
import * as ns from './other';
`;

    const violations = forbiddenDeclarationsCheck(
      rule,
      createContext(source, { bindings: ['import'] }),
    );

    expect(violations.map((violation) => violation.message)).toEqual([
      `Forbidden declaration 'foo' (import binding).`,
      `Forbidden declaration 'baz' (import binding).`,
      `Forbidden declaration 'ns' (import binding).`,
    ]);
  });

  it('flags catch bindings and destructured parameters', () => {
    const source = `
function run({ value }: { value: string }) {
  try {
    doWork();
  } catch ({ message }) {
    console.log(message, value);
  }
}
`;

    const violations = forbiddenDeclarationsCheck(
      rule,
      createContext(source, {
        symbols: ['parameter'],
        bindings: ['catch'],
      }),
    );

    expect(violations.map((violation) => violation.message)).toEqual([
      `Forbidden declaration 'value' (parameter).`,
      `Forbidden declaration 'message' (catch binding).`,
    ]);
  });

  it('flags named function-expression bindings separately from the outer variable', () => {
    const source = 'const run = function inner() { return 1; };';
    const violations = forbiddenDeclarationsCheck(
      rule,
      createContext(source, { bindings: ['function-expression-name'] }),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe(
      `Forbidden declaration 'inner' (function expression name).`,
    );
  });

  it.each([
    {
      label: 'var',
      source: 'var legacyValue = 1;',
      args: { syntax: ['var'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'legacyValue' (var).`,
    },
    {
      label: 'let',
      source: 'let mutableValue = 1;',
      args: { syntax: ['let'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'mutableValue' (let).`,
    },
    {
      label: 'abstract class',
      source: 'abstract class Base {}',
      args: { syntax: ['abstract-class'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'Base' (abstract class).`,
    },
    {
      label: 'generator function',
      source: 'function* iterate() { yield 1; }',
      args: { syntax: ['generator-function'] } satisfies ForbiddenDeclarationsArgs,
      expected: `Forbidden declaration 'iterate' (generator function).`,
    },
  ])('flags $label syntax bans', ({ source, args, expected }) => {
    const violations = forbiddenDeclarationsCheck(rule, createContext(source, args));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe(expected);
  });

  it('prefers syntax over symbols for var declarations', () => {
    const violations = forbiddenDeclarationsCheck(
      rule,
      createContext('var legacyValue = 1;', {
        symbols: ['variable'],
        syntax: ['var'],
      }),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe(`Forbidden declaration 'legacyValue' (var).`);
  });

  it('prefers syntax over symbols for abstract classes', () => {
    const violations = forbiddenDeclarationsCheck(
      rule,
      createContext('abstract class Base {}', {
        symbols: ['class'],
        syntax: ['abstract-class'],
      }),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe(`Forbidden declaration 'Base' (abstract class).`);
  });

  it('prefers syntax over symbols for generator functions', () => {
    const violations = forbiddenDeclarationsCheck(
      rule,
      createContext('function* iterate() { yield 1; }', {
        symbols: ['function'],
        syntax: ['generator-function'],
      }),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe(`Forbidden declaration 'iterate' (generator function).`);
  });

  it('flags anonymous default class and function exports via symbols', () => {
    const source = `
export default class {}
export default function() {}
`;

    const violations = forbiddenDeclarationsCheck(
      rule,
      createContext(source, { symbols: ['class', 'function'] }),
    );

    expect(violations.map((violation) => violation.message)).toEqual([
      `Forbidden declaration 'default' (class).`,
      `Forbidden declaration 'default' (function).`,
    ]);
  });

  it('returns empty violations when args are missing or empty', () => {
    expect(forbiddenDeclarationsCheck(rule, createContext('class Foo {}'))).toEqual([]);
    expect(
      forbiddenDeclarationsCheck(
        rule,
        createContext('class Foo {}', { symbols: [], bindings: [], syntax: [] }),
      ),
    ).toEqual([]);
  });

  it('reports the caller rule id and anchors syntax violations at the keyword', () => {
    const customRule: PolicyRule = {
      id: 'custom-forbidden-declarations',
      ruleId: 'fallback-id',
      targets: ['ts'],
    };
    const source = `// header
var legacyValue = 1;`;

    const violations = forbiddenDeclarationsCheck(
      customRule,
      createContext(source, { syntax: ['var'] }),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe('custom-forbidden-declarations');
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.column).toBe(1);
  });
});

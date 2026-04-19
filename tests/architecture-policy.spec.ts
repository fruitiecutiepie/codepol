import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  policyCheck,
  langAdd,
  parserInit,
  isOk,
  isErr,
  configCacheClear,
  pluginBuiltinRegister,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

/**
 * End-to-end exercise of the {@link ArchitectureCheckProvider}
 * capability: load a `codepol.toml` that declares the four built-in
 * architecture rules (`no-cycles`, `no-layer-violation`,
 * `dead-module`, `no-undeclared-implementer`), run them through the
 * public `policyCheck` entry point, and assert each rule produced
 * the expected violations.
 */
describe('architecture-policy end-to-end', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-arch-policy-'));

    // Layer setup:
    //   src/domain/* → may import shared
    //   src/infra/*  → may import domain & shared
    //   src/ui/*     → may import domain & shared
    //   src/shared/* → leaf
    //
    // Sources include:
    //   - a layer violation: src/domain/m.ts imports src/infra/db.ts
    //   - a circular import: src/util/a.ts <-> src/util/b.ts
    //   - a dead module: src/orphan.ts (unreachable from any entry)
    fs.mkdirSync(path.join(testDir, 'src/domain'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src/infra'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src/ui'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src/shared'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src/util'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src/contracts'), { recursive: true });

    fs.writeFileSync(
      path.join(testDir, 'src/ui/page.ts'),
      'import { domain } from "../domain/m"; export const page = domain;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/domain/m.ts'),
      'import { db } from "../infra/db"; import { util } from "../shared/util"; export const domain = db + util;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/infra/db.ts'),
      'import { util } from "../shared/util"; export const db = util;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/shared/util.ts'),
      'export const util = 1;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/util/a.ts'),
      'import { b } from "./b"; export const a = b;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/util/b.ts'),
      'import { a } from "./a"; export const b = a;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/orphan.ts'),
      'export const orphan = 99;\n',
      'utf8',
    );

    // Phase 9.5 / Gap 3 fixture: an interface plus two implementer
    // candidates. `Triangle` declares `implements`; `Duck` matches by
    // shape only (no `implements` clause, no import). The
    // `no-undeclared-implementer` rule should flag `Duck` and stay
    // silent on `Triangle`.
    //
    // Both implementers are kept reachable by re-exporting them from
    // `src/ui/page.ts` so the dead-module rule (entries =
    // `src/ui/**/*.ts`) doesn't see them as orphans and produce a
    // confounding violation.
    fs.writeFileSync(
      path.join(testDir, 'src/contracts/shape.ts'),
      'export interface IShape {\n  area(): number;\n  name: string;\n}\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/contracts/declared.ts'),
      'import { IShape } from "./shape";\n' +
        'export class Triangle implements IShape {\n' +
        '  name = "triangle";\n' +
        '  area(): number { return 0.5; }\n' +
        '}\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/contracts/duck.ts'),
      'export class Duck {\n' +
        '  name = "duck";\n' +
        '  area(): number { return 1; }\n' +
        '}\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'src/ui/contracts.ts'),
      'export { IShape } from "../contracts/shape";\n' +
        'export { Triangle } from "../contracts/declared";\n' +
        'export { Duck } from "../contracts/duck";\n',
      'utf8',
    );

    const configContent = `exclude = []

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
id = "no-cycles"
ruleId = "@codepol/plugin/no-cycles"
description = "No circular imports"
targets = ["src"]

[rules.args]
maxCycles = 50

[[rules]]
id = "no-layer-violation"
ruleId = "@codepol/plugin/no-layer-violation"
description = "Enforce layer boundaries"
targets = ["src"]

[rules.args.layers.domain]
files = ["src/domain/**/*.ts"]
allows = ["shared"]

[rules.args.layers.infra]
files = ["src/infra/**/*.ts"]
allows = ["domain", "shared"]

[rules.args.layers.ui]
files = ["src/ui/**/*.ts"]
allows = ["domain", "shared"]

[rules.args.layers.shared]
files = ["src/shared/**/*.ts"]

[[rules]]
id = "dead-module"
ruleId = "@codepol/plugin/dead-module"
description = "Reject unreachable modules"
targets = ["src"]

[rules.args]
entries = ["src/ui/**/*.ts"]

[[rules]]
id = "no-undeclared-implementer"
ruleId = "@codepol/plugin/no-undeclared-implementer"
description = "Forbid accidental structural-shape implementers"
targets = ["src"]

[rules.args]
interfaces = ["I*"]
`;
    fs.writeFileSync(path.join(testDir, 'codepol.toml'), configContent, 'utf8');
  });

  afterAll(() => {
    configCacheClear();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('runs all four architecture rules through policyCheck', async () => {
    const configPath = path.join(testDir, 'codepol.toml');
    const result = await policyCheck({ configPath, cwd: testDir });

    if (isErr(result)) {
      throw new Error(`policyCheck returned Err: ${result.Err}`);
    }
    expect(isOk(result)).toBe(true);

    const { architectureViolations, treeViolations } = result.Ok;
    expect(architectureViolations).toBeDefined();

    const archByRule = new Map<string, typeof treeViolations>();
    for (const v of architectureViolations!) {
      const list = archByRule.get(v.ruleId) ?? [];
      list.push(v);
      archByRule.set(v.ruleId, list);
    }

    // no-cycles: one violation for the a/b cycle in src/util.
    const cycles = archByRule.get('no-cycles') ?? [];
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    expect(cycles[0]!.message).toContain('Circular import');

    // no-layer-violation: domain importing from infra is forbidden.
    const layerViolations = archByRule.get('no-layer-violation') ?? [];
    expect(layerViolations.length).toBeGreaterThanOrEqual(1);
    const domainViolation = layerViolations.find((v) =>
      v.message.includes("Layer 'domain' is not allowed to import from layer 'infra'"),
    );
    expect(domainViolation).toBeDefined();

    // dead-module: src/orphan.ts is unreachable from src/ui/**.
    const dead = archByRule.get('dead-module') ?? [];
    expect(dead.length).toBeGreaterThanOrEqual(1);
    const orphan = dead.find((v) => v.filePath.endsWith('orphan.ts'));
    expect(orphan).toBeDefined();

    // no-undeclared-implementer: `Duck` (src/contracts/duck.ts) shape-
    // matches `IShape` without declaring `implements`. `Triangle`
    // declares `implements IShape` and must NOT be flagged.
    const undeclared = archByRule.get('no-undeclared-implementer') ?? [];
    const duckViolation = undeclared.find((v) =>
      v.filePath.endsWith('duck.ts'),
    );
    expect(duckViolation).toBeDefined();
    expect(duckViolation!.message).toContain('Duck');
    expect(duckViolation!.message).toContain('IShape');
    expect(duckViolation!.message).toContain('shape only');
    const triangleViolation = undeclared.find((v) =>
      v.filePath.endsWith('declared.ts'),
    );
    expect(triangleViolation).toBeUndefined();

    // Architecture violations are also surfaced through the legacy
    // treeViolations field for back-compat.
    const archIds = new Set(architectureViolations!.map((v) => v.ruleId));
    for (const id of archIds) {
      expect(treeViolations.some((v) => v.ruleId === id)).toBe(true);
    }
  });
});

/**
 * End-to-end coverage for the four additional Phase 3 user-facing
 * rules: `max-cycle-size`, `no-cross-package-internal-import`,
 * `max-fan-in`, `max-fan-out`, and `entry-point-allowlist`.
 *
 * Uses its own temp directory and `codepol.toml` because
 * `no-cross-package-internal-import` needs a real workspace layout
 * (pnpm-workspace.yaml + per-package package.json), which the layered
 * fixture above deliberately doesn't have.
 */
describe('architecture-policy phase-3 user-facing rules end-to-end', () => {
  let testDir: string;

  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
    pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-arch-policy-userface-'));

    // Workspace skeleton with two packages, each with a public entry
    // point at src/index.ts. Tests for `no-cross-package-internal-import`.
    fs.writeFileSync(
      path.join(testDir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
      'utf8',
    );
    fs.mkdirSync(path.join(testDir, 'packages/a/src'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'packages/b/src'), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'packages/a/package.json'),
      JSON.stringify({ name: '@t/a', main: './dist/index.js' }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'packages/b/package.json'),
      JSON.stringify({ name: '@t/b', main: './dist/index.js' }),
      'utf8',
    );

    // Package @t/a: a CLI-style hub that orchestrates several modules
    // (drives max-fan-out) and reaches into @t/b's internals (drives
    // no-cross-package-internal-import). It also imports @t/b's public
    // entry to prove the rule allows that.
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/index.ts'),
      [
        'import { one } from "./one";',
        'import { two } from "./two";',
        'import { three } from "./three";',
        'import { hub } from "./hub";',
        'import { b } from "../../b/src/index";',
        'import { secret } from "../../b/src/internal";',
        'export const main = one + two + three + hub + b + secret;',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/one.ts'),
      'import { hub } from "./hub"; export const one = hub;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/two.ts'),
      'import { hub } from "./hub"; export const two = hub;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/three.ts'),
      'import { hub } from "./hub"; export const three = hub;\n',
      'utf8',
    );
    // hub.ts has 4 importers (index, one, two, three) → triggers
    // max-fan-in with max=2.
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/hub.ts'),
      'export const hub = 1;\n',
      'utf8',
    );

    // Three-file cycle in @t/a triggering max-cycle-size with max=2.
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/cycA.ts'),
      'import { B } from "./cycB"; export const A = B;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/cycB.ts'),
      'import { C } from "./cycC"; export const B = C;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/cycC.ts'),
      'import { A } from "./cycA"; export const C = A;\n',
      'utf8',
    );
    // Pull the cycle into the import graph from the package entry so
    // the cycle files don't also trip the entry-point-allowlist rule.
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/cycRoot.ts'),
      'import { A } from "./cycA"; export const root = A;\n',
      'utf8',
    );

    // An orphan file in @t/a with no importers → triggers
    // entry-point-allowlist (entries only allow src/index.ts).
    fs.writeFileSync(
      path.join(testDir, 'packages/a/src/orphan.ts'),
      'export const orphan = 99;\n',
      'utf8',
    );

    // Package @t/b: public entry plus a deep "internal" file. The
    // internal file is exposed through the package's own entry so
    // dead-module and entry-point-allowlist don't see it as orphaned.
    fs.writeFileSync(
      path.join(testDir, 'packages/b/src/index.ts'),
      'import { secret } from "./internal"; export const b = secret;\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(testDir, 'packages/b/src/internal.ts'),
      'export const secret = 42;\n',
      'utf8',
    );

    const configContent = `exclude = []

[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["packages/**/*.ts"]

[[rules]]
id = "max-cycle-size"
ruleId = "@codepol/plugin/max-cycle-size"
description = "Cap individual cycle size"
targets = ["src"]

[rules.args]
max = 2

[[rules]]
id = "no-cross-package-internal-import"
ruleId = "@codepol/plugin/no-cross-package-internal-import"
description = "Cross-package imports must hit the public entry"
targets = ["src"]

[[rules]]
id = "max-fan-in"
ruleId = "@codepol/plugin/max-fan-in"
description = "Cap importer count"
targets = ["src"]

[rules.args]
max = 2
files = ["packages/a/src/hub.ts"]

[[rules]]
id = "max-fan-out"
ruleId = "@codepol/plugin/max-fan-out"
description = "Cap importee count"
targets = ["src"]

[rules.args]
max = 2
files = ["packages/a/src/index.ts"]

[[rules]]
id = "entry-point-allowlist"
ruleId = "@codepol/plugin/entry-point-allowlist"
description = "Only declared roots may have zero importers"
targets = ["src"]

[rules.args]
entries = ["packages/*/src/index.ts"]
`;
    fs.writeFileSync(path.join(testDir, 'codepol.toml'), configContent, 'utf8');
  });

  afterAll(() => {
    configCacheClear();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('runs max-cycle-size, no-cross-package-internal-import, max-fan-in, max-fan-out, and entry-point-allowlist through policyCheck', async () => {
    const configPath = path.join(testDir, 'codepol.toml');
    const result = await policyCheck({ configPath, cwd: testDir });

    if (isErr(result)) {
      throw new Error(`policyCheck returned Err: ${result.Err}`);
    }
    expect(isOk(result)).toBe(true);

    const { architectureViolations } = result.Ok;
    expect(architectureViolations).toBeDefined();

    const archByRule = new Map<string, typeof architectureViolations>();
    for (const v of architectureViolations!) {
      const list = archByRule.get(v.ruleId) ?? [];
      list!.push(v);
      archByRule.set(v.ruleId, list);
    }

    // max-cycle-size: 3-file cycle exceeds max=2.
    const cycleSize = archByRule.get('max-cycle-size') ?? [];
    expect(cycleSize!.length).toBeGreaterThanOrEqual(1);
    expect(cycleSize![0]!.message).toContain('exceeds max-cycle-size budget');

    // no-cross-package-internal-import: @t/a imports @t/b/src/internal.
    const crossPkg = archByRule.get('no-cross-package-internal-import') ?? [];
    expect(crossPkg!.length).toBeGreaterThanOrEqual(1);
    const internalEdge = crossPkg!.find((v) =>
      v.filePath.endsWith(path.join('packages', 'a', 'src', 'index.ts')),
    );
    expect(internalEdge).toBeDefined();
    expect(internalEdge!.message).toContain("'@t/a'");
    expect(internalEdge!.message).toContain("'@t/b'");

    // max-fan-in: hub.ts has > 2 importers.
    const fanIn = archByRule.get('max-fan-in') ?? [];
    expect(fanIn!.length).toBe(1);
    expect(fanIn![0]!.filePath).toContain(path.join('packages', 'a', 'src', 'hub.ts'));

    // max-fan-out: packages/a/src/index.ts imports > 2 modules.
    const fanOut = archByRule.get('max-fan-out') ?? [];
    expect(fanOut!.length).toBe(1);
    expect(fanOut![0]!.filePath).toContain(path.join('packages', 'a', 'src', 'index.ts'));

    // entry-point-allowlist: only packages/*/src/index.ts allowed; the
    // orphan in @t/a should be reported.
    const entries = archByRule.get('entry-point-allowlist') ?? [];
    const orphan = entries!.find((v) => v.filePath.endsWith('orphan.ts'));
    expect(orphan).toBeDefined();
    // Entry-point files (packages/a/src/index.ts and packages/b/src/index.ts)
    // must NOT be reported.
    const indexHit = entries!.find((v) => v.filePath.endsWith(path.join('src', 'index.ts')));
    expect(indexHit).toBeUndefined();
  });
});

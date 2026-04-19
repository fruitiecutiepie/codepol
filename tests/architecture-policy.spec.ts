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

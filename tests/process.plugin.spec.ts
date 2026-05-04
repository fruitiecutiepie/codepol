import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configCacheClear,
  configGetFromPath,
  isErr,
  isOk,
  langAdd,
  parserInit,
  pluginGetForRule,
  policyCheck,
  policyPluginsGet,
  policyRuleTargetsResolve,
  ruleMatchesGet,
  type PolicyFile,
  type PolicyRuleTargetContext,
} from '@codepol/core';

const processPluginPath = path.resolve(__dirname, 'fixtures', 'process-plugin.cjs');

type ProcessPluginTargetConfig = {
  language: string;
  files: string[];
};

function processPluginConfigCreate(
  ruleBlocks: string,
  target: ProcessPluginTargetConfig = {
    language: 'typescript',
    files: ['src/**/*.ts'],
  }
): string {
  return `[[plugins]]
id = "fixture/process-plugin"

[plugins.source]
kind = "process"
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(processPluginPath)}]
timeoutMs = 5000

[targets.src]
language = ${JSON.stringify(target.language)}
files = ${JSON.stringify(target.files)}

${ruleBlocks}
`;
}

function ruleTargetsGet(policy: PolicyFile): PolicyRuleTargetContext[] {
  const targets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    const resolvedTargetsR = policyRuleTargetsResolve(rule, policy);
    if (isErr(resolvedTargetsR)) {
      continue;
    }
    for (const target of resolvedTargetsR.Ok) {
      targets.push({
        ruleId: rule.ruleId,
        description: rule.description,
        args: rule.args,
        target,
      });
    }
  }
  return targets;
}

describe('process plugins', () => {
  let tempDirs: string[] = [];

  beforeAll(async () => {
    langAdd({ langId: 'python', fileExtensions: ['.py'] });
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  afterAll(() => {
    configCacheClear();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads subprocess plugin rules and reports violations', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-process-plugin-'));
    tempDirs.push(dir);

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), '// TODO fix\nexport const value = 1;\n', 'utf8');

    const configPath = path.join(dir, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      processPluginConfigCreate(`[[rules]]
id = "todo-comment"
ruleId = "fixture/process-plugin/no-todo-comment"
targets = ["src"]
`),
      'utf8',
    );

    const result = await policyCheck({ configPath, cwd: dir });
    if (isErr(result)) {
      throw new Error(result.Err);
    }

    expect(isOk(result)).toBe(true);
    expect(result.Ok.treeViolations).toHaveLength(1);
    expect(result.Ok.treeViolations[0].message).toContain('TODO comment');
  });

  it('passes a project index snapshot to subprocess rules that require it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-process-index-'));
    tempDirs.push(dir);

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const value = 1;\n', 'utf8');

    const configPath = path.join(dir, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      processPluginConfigCreate(`[[rules]]
id = "index-check"
ruleId = "fixture/process-plugin/requires-index"
targets = ["src"]
`),
      'utf8',
    );

    const result = await policyCheck({ configPath, cwd: dir });
    if (isErr(result)) {
      throw new Error(result.Err);
    }

    expect(result.Ok.treeViolations).toHaveLength(0);
  });

  it('allows subprocess rules that omit languages to match python targets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-process-plugin-python-'));
    tempDirs.push(dir);

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.py'), '# TODO fix\nvalue = 1\n', 'utf8');

    const configPath = path.join(dir, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      processPluginConfigCreate(`[[rules]]
id = "todo-comment-any-language"
ruleId = "fixture/process-plugin/no-todo-comment-any-language"
targets = ["src"]
`, {
        language: 'python',
        files: ['src/**/*.py'],
      }),
      'utf8',
    );

    const result = await policyCheck({ configPath, cwd: dir });
    if (isErr(result)) {
      throw new Error(result.Err);
    }

    expect(result.Ok.treeViolations).toHaveLength(1);
    expect(result.Ok.treeViolations[0].message).toContain('TODO comment');
  });

  it('applies subprocess-provided fixes through wrapped fix providers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-process-fix-'));
    tempDirs.push(dir);

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const filePath = path.join(dir, 'src', 'app.ts');
    fs.writeFileSync(filePath, '// TODO remove\nexport const value = 1;\n', 'utf8');

    const configPath = path.join(dir, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      processPluginConfigCreate(`[[rules]]
id = "todo-comment"
ruleId = "fixture/process-plugin/no-todo-comment"
targets = ["src"]
`),
      'utf8',
    );

    const cfgR = await configGetFromPath(configPath);
    if (isErr(cfgR)) {
      throw new Error(cfgR.Err.message);
    }
    const { config } = cfgR.Ok;
    const policy = config as PolicyFile;
    const pluginsResult = await policyPluginsGet(policy, dir, { configPath });
    if (isErr(pluginsResult)) {
      throw new Error(pluginsResult.Err);
    }

    const lookup = pluginGetForRule(pluginsResult.Ok, 'fixture/process-plugin/no-todo-comment');
    if (!lookup || !lookup.plugin.pluginRule.capabilities.fixProvider) {
      throw new Error('Expected process plugin fix provider to be available');
    }

    const matchesR = await ruleMatchesGet(policy, dir);
    if (isErr(matchesR)) {
      throw new Error(matchesR.Err.message);
    }
    const matches = matchesR.Ok;
    const files = Array.from(new Set(matches.flatMap((match) => match.files)));
    await lookup.plugin.pluginRule.capabilities.fixProvider.apply({
      cwd: dir,
      policy,
      configPath,
      files,
      ruleTargets: ruleTargetsGet(policy),
    });

    const fixed = fs.readFileSync(filePath, 'utf8');
    expect(fixed).not.toContain('TODO');
  });
});

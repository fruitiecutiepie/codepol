import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function extensionManifestGet(): {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
  };
} {
  return JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'extension-vscode', 'package.json'),
      'utf8',
    ),
  ) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
    };
  };
}

describe('extension-vscode manifest', () => {
  it('contributes the lint rule panel command with a context-menu entry for lint rule items', () => {
    const manifest = extensionManifestGet();

    expect(manifest.contributes.commands).toContainEqual({
      command: 'codepol.extension.showLintRuleDetails',
      title: 'Codepol: Open Lint Rule Details Panel',
    });
    expect(manifest.contributes.menus['view/item/context']).toContainEqual({
      command: 'codepol.extension.showLintRuleDetails',
      when: 'view == codepol.lintRules && viewItem == codepol.lintRule',
      group: 'inline',
    });
  });
});

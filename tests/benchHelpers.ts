/**
 * Shared helpers for benchmark files.
 *
 * Generates realistic multi-file TypeScript projects in a temp directory
 * so benchmarks measure indexing/querying, not project construction.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ============================================================================
// Types
// ============================================================================

export type GeneratedProject = {
  /** Absolute path to the temp directory */
  dir: string;
  /** Absolute paths to all generated files */
  files: string[];
};

// ============================================================================
// File content generators
// ============================================================================

/**
 * Generate the source content for a single TypeScript file.
 *
 * Each file contains:
 * - 3 exported functions (one async)
 * - 1 exported class with a method
 * - 1 exported type alias
 * - 1 exported interface
 * - Import statements referencing `importFrom` files (if provided)
 */
function fileContentGenerate(
  fileIndex: number,
  importFrom: number[],
  fileNameFn: (i: number) => string,
): string {
  const lines: string[] = [];

  // Imports from other generated files
  for (const dep of importFrom) {
    const depBase = path.basename(fileNameFn(dep), '.ts');
    lines.push(
      `import { greet_${dep}, Helper_${dep} } from './${depBase}';`,
    );
  }

  if (importFrom.length > 0) lines.push('');

  // Exported functions
  lines.push(
    `export function greet_${fileIndex}(name: string): string {`,
    `  return 'hello ' + name;`,
    `}`,
    '',
    `export function compute_${fileIndex}(a: number, b: number): number {`,
  );
  // Use imported symbols so they count as references
  for (const dep of importFrom) {
    lines.push(`  greet_${dep}('bench');`);
  }
  lines.push(`  return a + b;`, `}`, '');

  lines.push(
    `export async function fetch_${fileIndex}(): Promise<string[]> {`,
    `  return [];`,
    `}`,
    '',
  );

  // Exported class
  lines.push(
    `export class Helper_${fileIndex} {`,
    `  value: number;`,
    `  constructor(v: number) { this.value = v; }`,
    `  run(): number { return this.value * 2; }`,
    `}`,
    '',
  );

  // Use imported class so it counts as a reference
  for (const dep of importFrom) {
    lines.push(`const _inst_${dep} = new Helper_${dep}(1);`);
  }
  if (importFrom.length > 0) lines.push('');

  // Type alias + interface
  lines.push(
    `export type Config_${fileIndex} = { key: string; value: number };`,
    '',
    `export interface Service_${fileIndex} {`,
    `  start(): void;`,
    `  stop(): void;`,
    `}`,
  );

  return lines.join('\n') + '\n';
}

// ============================================================================
// Project generators
// ============================================================================

/**
 * Generate a temp directory with `count` interconnected TypeScript files.
 *
 * Each file imports from up to 3 earlier files, creating a realistic
 * dependency topology (linear + some fan-out, no cycles by construction).
 */
export function benchProjectGenerate(count: number): GeneratedProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-bench-'));
  const files: string[] = [];
  const fileName = (i: number) => `file_${String(i).padStart(4, '0')}.ts`;

  for (let i = 0; i < count; i++) {
    // Each file imports from up to 3 earlier files
    const importFrom: number[] = [];
    if (i > 0) importFrom.push(i - 1);
    if (i > 3) importFrom.push(i - 3);
    if (i > 7) importFrom.push(i - 7);

    const content = fileContentGenerate(i, importFrom, fileName);
    const filePath = path.join(dir, fileName(i));
    fs.writeFileSync(filePath, content);
    files.push(filePath);
  }

  return { dir, files };
}

/**
 * Clean up a generated project directory.
 */
export function benchProjectCleanup(project: GeneratedProject): void {
  fs.rmSync(project.dir, { recursive: true, force: true });
}

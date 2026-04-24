import { parserInit } from './parserInit';
import { langAdd, type Lang } from './parserLangs';

export type ProviderParserRuntime = 'eslint' | 'biome' | 'ruff';

const JS_TS_PROVIDER_LANGS: Lang[] = [
  {
    langId: 'typescript',
    fileExtensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'],
  },
  {
    langId: 'tsx',
    fileExtensions: ['.tsx', '.jsx'],
  },
];

const PYTHON_PROVIDER_LANGS: Lang[] = [
  {
    langId: 'python',
    fileExtensions: ['.py', '.pyw'],
  },
];

const providerParserLangs: Record<ProviderParserRuntime, Lang[]> = {
  eslint: JS_TS_PROVIDER_LANGS,
  biome: JS_TS_PROVIDER_LANGS,
  ruff: PYTHON_PROVIDER_LANGS,
};

/**
 * Explicitly initializes parser/runtime dependencies for lint-provider hosts
 * that adapt tree-check rules.
 *
 * Call this during host startup before executing adapted rules. This keeps the
 * parser dependency explicit instead of relying on unrelated helpers like
 * `providerRulesConfigGet()` to perform hidden runtime bootstrap.
 */
export async function providerParserRuntimeInit(
  provider: ProviderParserRuntime,
): Promise<void> {
  for (const lang of providerParserLangs[provider]) {
    langAdd(lang);
  }
  await parserInit();
}

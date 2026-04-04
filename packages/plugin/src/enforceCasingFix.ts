import {
  nameMatchesCasingStyle,
  type CasingStyleName,
} from './lib/casingConvention';
import { identifierSplitByCasing } from './lib/identifierSplitByCasing';

/**
 * Leading underscores (private / dunder) preserved; core is split into words for conversion.
 */
function leadingUnderscoresSplit(name: string): { prefix: string; core: string } {
  const m = name.match(/^(_+)(.*)$/);
  if (!m) {
    return { prefix: '', core: name };
  }
  return { prefix: m[1], core: m[2] };
}

function capitalizeWord(word: string): string {
  if (word.length === 0) {
    return '';
  }
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function wordsToStyle(words: string[], style: CasingStyleName): string {
  if (words.length === 0) {
    return '';
  }
  switch (style) {
    case 'camelCase': {
      const first = words[0].toLowerCase();
      const rest = words.slice(1).map(capitalizeWord);
      return first + rest.join('');
    }
    case 'PascalCase':
      return words.map(capitalizeWord).join('');
    case 'snake_case':
      return words.map((w) => w.toLowerCase()).join('_');
    case 'SCREAMING_SNAKE_CASE':
      return words.map((w) => w.toUpperCase()).join('_');
    case 'kebab-case':
      return words.map((w) => w.toLowerCase()).join('-');
    default: {
      const _exhaustive: never = style;
      return _exhaustive;
    }
  }
}

type EnforceCasingReplacement = {
  style: CasingStyleName;
  text: string;
};

/**
 * Produces one replacement candidate per allowed style, deduped by full identifier text.
 * Skips candidates that do not satisfy {@link nameMatchesCasingStyle} for that style.
 */
export function enforceCasingReplacements(
  name: string,
  allowed: CasingStyleName[],
): EnforceCasingReplacement[] {
  const { prefix, core } = leadingUnderscoresSplit(name);
  if (core.length === 0) {
    return [];
  }
  const words = identifierSplitByCasing(core);
  if (words.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const out: EnforceCasingReplacement[] = [];
  for (const style of allowed) {
    const convertedCore = wordsToStyle(words, style);
    if (!nameMatchesCasingStyle(convertedCore, style)) {
      continue;
    }
    const full = prefix + convertedCore;
    if (seen.has(full)) {
      continue;
    }
    seen.add(full);
    out.push({ style, text: full });
  }
  return out;
}

/**
 * Classifies identifiers and path segments against common casing styles.
 * Used by the enforce-casing policy rule.
 */

export type CasingStyleName =
  | 'camelCase'
  | 'snake_case'
  | 'PascalCase'
  | 'SCREAMING_SNAKE_CASE'
  | 'kebab-case';

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SCREAMING_SNAKE_CASE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Strips leading underscores (private / dunder prefixes) before casing checks.
 */
export function nameStripLeadingUnderscores(name: string): string {
  return name.replace(/^_+/, '');
}

/**
 * Returns true if `name` matches exactly one of the allowed casing styles.
 */
export function nameMatchesAnyCasingStyle(
  name: string,
  allowed: CasingStyleName[],
): boolean {
  if (allowed.length === 0) {
    return true;
  }
  const stripped = nameStripLeadingUnderscores(name);
  if (stripped.length === 0) {
    return false;
  }
  for (const style of allowed) {
    if (nameMatchesCasingStyle(stripped, style)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether `name` (already stripped of leading underscores) matches `style`.
 */
export function nameMatchesCasingStyle(
  name: string,
  style: CasingStyleName,
): boolean {
  switch (style) {
    case 'camelCase':
      return CAMEL_CASE.test(name);
    case 'PascalCase':
      return PASCAL_CASE.test(name);
    case 'snake_case':
      return SNAKE_CASE.test(name);
    case 'SCREAMING_SNAKE_CASE':
      return SCREAMING_SNAKE_CASE.test(name);
    case 'kebab-case':
      return KEBAB_CASE.test(name);
    default: {
      const _exhaustive: never = style;
      return _exhaustive;
    }
  }
}

/**
 * Human-readable list of allowed styles for violation messages.
 */
export function casingStylesDescribe(allowed: CasingStyleName[]): string {
  return allowed.join(', ');
}

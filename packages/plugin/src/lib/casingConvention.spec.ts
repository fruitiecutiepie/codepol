import { describe, it, expect } from 'vitest';
import {
  nameMatchesAnyCasingStyle,
  nameMatchesCasingStyle,
  nameStripLeadingUnderscores,
  casingStylesDescribe,
} from './casingConvention';

describe('nameStripLeadingUnderscores', () => {
  it('removes leading underscores', () => {
    expect(nameStripLeadingUnderscores('__init__')).toBe('init__');
    expect(nameStripLeadingUnderscores('_private')).toBe('private');
  });

  it('leaves names without leading underscores', () => {
    expect(nameStripLeadingUnderscores('foo')).toBe('foo');
  });
});

describe('nameMatchesCasingStyle', () => {
  describe('camelCase', () => {
    it('accepts typical names', () => {
      expect(nameMatchesCasingStyle('getUser', 'camelCase')).toBe(true);
      expect(nameMatchesCasingStyle('getHTTP', 'camelCase')).toBe(true);
      expect(nameMatchesCasingStyle('a', 'camelCase')).toBe(true);
    });

    it('rejects PascalCase and snake_case', () => {
      expect(nameMatchesCasingStyle('GetUser', 'camelCase')).toBe(false);
      expect(nameMatchesCasingStyle('get_user', 'camelCase')).toBe(false);
    });
  });

  describe('PascalCase', () => {
    it('accepts typical names', () => {
      expect(nameMatchesCasingStyle('UserService', 'PascalCase')).toBe(true);
      expect(nameMatchesCasingStyle('XMLParser', 'PascalCase')).toBe(true);
      expect(nameMatchesCasingStyle('A', 'PascalCase')).toBe(true);
    });

    it('rejects camelCase', () => {
      expect(nameMatchesCasingStyle('userService', 'PascalCase')).toBe(false);
    });
  });

  describe('snake_case', () => {
    it('accepts typical names', () => {
      expect(nameMatchesCasingStyle('get_user', 'snake_case')).toBe(true);
      expect(nameMatchesCasingStyle('a', 'snake_case')).toBe(true);
    });

    it('rejects camelCase', () => {
      expect(nameMatchesCasingStyle('getUser', 'snake_case')).toBe(false);
    });
  });

  describe('SCREAMING_SNAKE_CASE', () => {
    it('accepts typical names', () => {
      expect(nameMatchesCasingStyle('MAX_SIZE', 'SCREAMING_SNAKE_CASE')).toBe(
        true,
      );
    });

    it('rejects snake_case', () => {
      expect(nameMatchesCasingStyle('max_size', 'SCREAMING_SNAKE_CASE')).toBe(
        false,
      );
    });
  });

  describe('kebab-case', () => {
    it('accepts path-style names', () => {
      expect(nameMatchesCasingStyle('user-service', 'kebab-case')).toBe(true);
    });

    it('rejects underscores', () => {
      expect(nameMatchesCasingStyle('user_service', 'kebab-case')).toBe(false);
    });
  });
});

describe('nameMatchesAnyCasingStyle', () => {
  it('returns true when empty allowed list', () => {
    expect(nameMatchesAnyCasingStyle('anything', [])).toBe(true);
  });

  it('matches first matching style', () => {
    expect(
      nameMatchesAnyCasingStyle('FOO_BAR', [
        'camelCase',
        'SCREAMING_SNAKE_CASE',
      ]),
    ).toBe(true);
  });

  it('allows leading underscores via strip', () => {
    expect(
      nameMatchesAnyCasingStyle('_getUser', ['camelCase']),
    ).toBe(true);
  });
});

describe('casingStylesDescribe', () => {
  it('joins styles', () => {
    expect(casingStylesDescribe(['camelCase', 'PascalCase'])).toBe(
      'camelCase, PascalCase',
    );
  });
});

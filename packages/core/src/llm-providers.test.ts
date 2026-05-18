import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_IDS } from './llm-providers.js';

describe('PROVIDERS registry', () => {
  it('exposes both built-in providers', () => {
    expect(PROVIDER_IDS).toContain('claude');
    expect(PROVIDER_IDS).toContain('codex');
  });

  it('every entry has the fields the invoker reads', () => {
    for (const id of PROVIDER_IDS) {
      const def = PROVIDERS[id];
      expect(def.id).toBe(id);
      expect(typeof def.displayName).toBe('string');
      expect(typeof def.binary).toBe('string');
      expect(Array.isArray(def.versionArgv)).toBe(true);
      expect(typeof def.promptArgv).toBe('function');
    }
  });

  it('preserves the historical argv shapes (back-compat guard)', () => {
    expect(PROVIDERS.claude.binary).toBe('claude');
    expect(PROVIDERS.claude.promptArgv('hi')).toEqual(['--print', 'hi']);
    expect(PROVIDERS.codex.binary).toBe('codex');
    expect(PROVIDERS.codex.promptArgv('hi')).toEqual(['exec', '-s', 'read-only', 'hi']);
  });
});

import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG, lookupErrorHelp, renderTroubleshootingMarkdown } from './error-catalog.js';

// Every NodeErrorCategory must have a catalog entry (kept in sync with
// agent-v2-types.ts). A new category without troubleshooting fails here.
const NODE_ERROR_CATEGORIES = [
  'setup', 'input_resolution', 'spawn_failure', 'exit_nonzero', 'timeout',
  'cancelled', 'abandoned', 'upstream_failed', 'condition_not_met',
  'flow_ended', 'invalid_output', 'policy_denied',
] as const;

// Every code in failure-explain's EXIT_CODE_LABELS worth troubleshooting.
const EXIT_CODES = ['1', '2', '3', '6', '7', '22', '28', '126', '127', '128', '130', '137', '139', '143'];

describe('ERROR_CATALOG', () => {
  it('has a well-formed entry for every NodeErrorCategory', () => {
    for (const cat of NODE_ERROR_CATEGORIES) {
      const entry = ERROR_CATALOG.find((e) => e.kind === 'category' && e.key === cat);
      expect(entry, `missing catalog entry for category ${cat}`).toBeDefined();
      expect(entry!.label).toBeTruthy();
      expect(entry!.meaning.length).toBeGreaterThan(10);
      expect(entry!.commonCauses.length).toBeGreaterThan(0);
      expect(entry!.troubleshooting.length).toBeGreaterThan(0);
    }
  });

  it('has an entry for every catalogued exit code', () => {
    for (const code of EXIT_CODES) {
      const entry = ERROR_CATALOG.find((e) => e.kind === 'exit_code' && e.key === code);
      expect(entry, `missing catalog entry for exit code ${code}`).toBeDefined();
      expect(entry!.troubleshooting.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a unique kind+key', () => {
    const seen = new Set<string>();
    for (const e of ERROR_CATALOG) {
      const k = `${e.kind}:${e.key}`;
      expect(seen.has(k), `duplicate catalog key ${k}`).toBe(false);
      seen.add(k);
    }
  });
});

describe('lookupErrorHelp', () => {
  it('prefers the specific exit code over the generic category', () => {
    const help = lookupErrorHelp({ category: 'exit_nonzero', exitCode: 127 });
    expect(help?.kind).toBe('exit_code');
    expect(help?.key).toBe('127');
    expect(help?.meaning.toLowerCase()).toContain('command not found');
  });

  it('falls back to the category when the exit code is not catalogued', () => {
    const help = lookupErrorHelp({ category: 'exit_nonzero', exitCode: 42 });
    expect(help?.kind).toBe('category');
    expect(help?.key).toBe('exit_nonzero');
  });

  it('resolves a category with no exit code', () => {
    expect(lookupErrorHelp({ category: 'timeout' })?.key).toBe('timeout');
    expect(lookupErrorHelp({ category: 'policy_denied' })?.kind).toBe('category');
  });

  it('returns undefined when nothing matches', () => {
    expect(lookupErrorHelp({ category: 'nonsense-xyz' })).toBeUndefined();
    expect(lookupErrorHelp({})).toBeUndefined();
  });
});

describe('renderTroubleshootingMarkdown', () => {
  it('renders meaning, causes, and numbered steps', () => {
    const entry = lookupErrorHelp({ exitCode: 127 })!;
    const md = renderTroubleshootingMarkdown(entry);
    expect(md).toContain('**What this means:**');
    expect(md).toContain('Likely causes:');
    expect(md).toContain('Try:');
    expect(md).toContain('1.');
  });
});

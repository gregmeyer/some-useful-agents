import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VariablesStore, looksLikeSensitive } from './variables-store.js';

let dir: string;
let store: VariablesStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-vars-'));
  store = new VariablesStore(join(dir, '.sua', 'variables.json'));
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('VariablesStore', () => {
  it('starts empty', () => {
    expect(store.listNames()).toEqual([]);
    expect(store.getAll()).toEqual({});
  });

  it('sets and gets a variable', () => {
    store.set('API_URL', 'https://api.example.com', 'Base URL');
    expect(store.getValue('API_URL')).toBe('https://api.example.com');
    expect(store.get('API_URL')).toEqual({ value: 'https://api.example.com', description: 'Base URL' });
  });

  it('lists variables sorted', () => {
    store.set('B_VAR', 'b');
    store.set('A_VAR', 'a');
    expect(store.listNames()).toEqual(['A_VAR', 'B_VAR']);
  });

  it('overwrites existing value', () => {
    store.set('X', 'old');
    store.set('X', 'new');
    expect(store.getValue('X')).toBe('new');
  });

  it('deletes a variable', () => {
    store.set('DOOMED', 'value');
    expect(store.delete('DOOMED')).toBe(true);
    expect(store.has('DOOMED')).toBe(false);
  });

  it('returns false when deleting nonexistent', () => {
    expect(store.delete('GHOST')).toBe(false);
  });

  it('persists across instances', () => {
    store.set('PERSIST', 'yes');
    const store2 = new VariablesStore(join(dir, '.sua', 'variables.json'));
    expect(store2.getValue('PERSIST')).toBe('yes');
  });

  it('getAll returns flat name→value map', () => {
    store.set('A', '1');
    store.set('B', '2');
    expect(store.getAll()).toEqual({ A: '1', B: '2' });
  });
});

describe('looksLikeSensitive', () => {
  it('flags TOKEN, KEY, PASS, SECRET', () => {
    expect(looksLikeSensitive('API_TOKEN')).toBe(true);
    expect(looksLikeSensitive('MY_KEY')).toBe(true);
    expect(looksLikeSensitive('DB_PASSWORD')).toBe(true);
    expect(looksLikeSensitive('SHARED_SECRET')).toBe(true);
  });

  it('does not flag normal names', () => {
    expect(looksLikeSensitive('API_URL')).toBe(false);
    expect(looksLikeSensitive('REGION')).toBe(false);
    expect(looksLikeSensitive('DEFAULT_TIMEOUT')).toBe(false);
  });
});

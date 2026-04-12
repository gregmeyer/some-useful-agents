import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EncryptedFileStore, MemorySecretsStore } from './secrets-store.js';

const TEST_DIR = join(import.meta.dirname, '__test-secrets__');
const TEST_PATH = join(TEST_DIR, 'secrets.enc');

beforeEach(() => {
  // Clean start
  rmSync(TEST_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('EncryptedFileStore', () => {
  it('creates data directory if missing', () => {
    new EncryptedFileStore(TEST_PATH);
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it('returns undefined for missing secret', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    expect(await store.get('MISSING')).toBeUndefined();
  });

  it('sets and retrieves a secret', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    await store.set('MY_KEY', 'secret-value');
    expect(await store.get('MY_KEY')).toBe('secret-value');
  });

  it('persists across instances', async () => {
    const s1 = new EncryptedFileStore(TEST_PATH);
    await s1.set('KEY_A', 'value-a');

    const s2 = new EncryptedFileStore(TEST_PATH);
    expect(await s2.get('KEY_A')).toBe('value-a');
  });

  it('stores file encrypted (not plaintext)', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    await store.set('API_KEY', 'my-super-secret-value');

    const raw = readFileSync(TEST_PATH, 'utf-8');
    expect(raw).not.toContain('my-super-secret-value');
    expect(raw).not.toContain('API_KEY');
    // Should be JSON with encrypted payload
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.iv).toBeTruthy();
    expect(parsed.tag).toBeTruthy();
    expect(parsed.data).toBeTruthy();
  });

  it('lists secret names', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    await store.set('B_KEY', 'b');
    await store.set('A_KEY', 'a');
    await store.set('C_KEY', 'c');
    expect(await store.list()).toEqual(['A_KEY', 'B_KEY', 'C_KEY']);
  });

  it('deletes secret', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    await store.set('KEEP', 'yes');
    await store.set('DELETE_ME', 'bye');
    await store.delete('DELETE_ME');
    expect(await store.get('DELETE_ME')).toBeUndefined();
    expect(await store.get('KEEP')).toBe('yes');
  });

  it('has() checks existence', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    await store.set('EXISTS', 'yes');
    expect(await store.has('EXISTS')).toBe(true);
    expect(await store.has('NOPE')).toBe(false);
  });

  it('getAll returns all secrets as object', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    await store.set('KEY_1', 'value-1');
    await store.set('KEY_2', 'value-2');
    const all = await store.getAll();
    expect(all).toEqual({ KEY_1: 'value-1', KEY_2: 'value-2' });
  });

  it('overwrites existing secret on set', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    await store.set('KEY', 'v1');
    await store.set('KEY', 'v2');
    expect(await store.get('KEY')).toBe('v2');
  });

  it('handles empty store', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    expect(await store.list()).toEqual([]);
    expect(await store.getAll()).toEqual({});
  });
});

describe('MemorySecretsStore', () => {
  it('provides full store interface', async () => {
    const store = new MemorySecretsStore();
    await store.set('K', 'v');
    expect(await store.get('K')).toBe('v');
    expect(await store.has('K')).toBe(true);
    expect(await store.list()).toEqual(['K']);
    expect(await store.getAll()).toEqual({ K: 'v' });
    await store.delete('K');
    expect(await store.has('K')).toBe(false);
  });
});

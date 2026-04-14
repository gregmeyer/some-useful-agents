import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scryptSync, createCipheriv, randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import {
  EncryptedFileStore,
  MemorySecretsStore,
  inspectSecretsFile,
} from './secrets-store.js';

const TEST_DIR = join(import.meta.dirname, '__test-secrets__');
const TEST_PATH = join(TEST_DIR, 'secrets.enc');

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.SUA_SECRETS_PASSPHRASE;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.SUA_SECRETS_PASSPHRASE;
});

/**
 * Write a legacy v1 payload directly so we can exercise the backward-compat
 * reader and the v1→v2 migration path.
 */
function writeLegacyV1(path: string, data: Record<string, string>): void {
  mkdirSync(TEST_DIR, { recursive: true });
  const key = scryptSync(`${hostname()}:${userInfo().username}`, 'sua-secrets-v1', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data))), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = {
    version: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
}

describe('EncryptedFileStore (v2 passphrase)', () => {
  it('creates data directory if missing', () => {
    new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it('round-trips a secret with a passphrase', async () => {
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await store.set('MY_KEY', 'secret-value');
    expect(await store.get('MY_KEY')).toBe('secret-value');
  });

  it('persists across instances with the same passphrase', async () => {
    const a = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await a.set('KEY_A', 'value-a');

    const b = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    expect(await b.get('KEY_A')).toBe('value-a');
  });

  it('writes a v2 payload with the expected shape', async () => {
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await store.set('API_KEY', 'my-super-secret-value');

    const raw = readFileSync(TEST_PATH, 'utf-8');
    expect(raw).not.toContain('my-super-secret-value');
    expect(raw).not.toContain('API_KEY');

    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
    expect(parsed.salt).toBeTruthy();
    expect(parsed.iv).toBeTruthy();
    expect(parsed.tag).toBeTruthy();
    expect(parsed.data).toBeTruthy();
    expect(parsed.kdfParams).toEqual({ algorithm: 'scrypt', N: 131072, r: 8, p: 1, keyLength: 32 });
    expect(parsed.obfuscatedFallback).toBeUndefined();
  });

  it('fails with a clear error on wrong passphrase', async () => {
    const writer = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await writer.set('K', 'v');

    const reader = new EncryptedFileStore(TEST_PATH, { passphrase: 'wrong' });
    await expect(reader.get('K')).rejects.toThrow(/wrong passphrase/);
  });

  it('requires a passphrase on read when none is supplied', async () => {
    const writer = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await writer.set('K', 'v');

    const reader = new EncryptedFileStore(TEST_PATH);
    await expect(reader.get('K')).rejects.toThrow(/passphrase-protected/);
  });

  it('reuses existing salt + kdfParams on subsequent writes', async () => {
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await store.set('K1', 'v1');
    const first = JSON.parse(readFileSync(TEST_PATH, 'utf-8'));

    await store.set('K2', 'v2');
    const second = JSON.parse(readFileSync(TEST_PATH, 'utf-8'));

    expect(second.salt).toBe(first.salt);
    expect(second.kdfParams).toEqual(first.kdfParams);
    // IV should rotate per write.
    expect(second.iv).not.toBe(first.iv);
  });

  it('honors non-default kdfParams from the payload on read', async () => {
    // Use the minimum allowed N (16384) so the reader runs fast but still
    // exercises the non-default path and our KDF bounds validation.
    const passphrase = 'hunter2';
    const salt = randomBytes(16);
    const kdfParams = { algorithm: 'scrypt' as const, N: 16384, r: 8, p: 1, keyLength: 32 };
    const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify({ X: '1' }))), cipher.final()]);
    const tag = cipher.getAuthTag();
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_PATH, JSON.stringify({
      version: 2,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64'),
      kdfParams,
    }), 'utf-8');

    const store = new EncryptedFileStore(TEST_PATH, { passphrase });
    expect(await store.get('X')).toBe('1');
  });

  it('reads passphrase from SUA_SECRETS_PASSPHRASE env var', async () => {
    const writer = new EncryptedFileStore(TEST_PATH, { passphrase: 'env-pass' });
    await writer.set('K', 'v');

    process.env.SUA_SECRETS_PASSPHRASE = 'env-pass';
    const reader = new EncryptedFileStore(TEST_PATH);
    expect(await reader.get('K')).toBe('v');
  });

  it('lists, deletes, has, getAll with passphrase', async () => {
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await store.set('B_KEY', 'b');
    await store.set('A_KEY', 'a');
    expect(await store.list()).toEqual(['A_KEY', 'B_KEY']);
    expect(await store.has('A_KEY')).toBe(true);
    expect(await store.getAll()).toEqual({ A_KEY: 'a', B_KEY: 'b' });
    await store.delete('A_KEY');
    expect(await store.has('A_KEY')).toBe(false);
  });

  it('writes file with 0o600 perms (Unix only)', async () => {
    if (process.platform === 'win32') return;
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await store.set('K', 'v');
    const mode = statSync(TEST_PATH).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('EncryptedFileStore (empty-passphrase / obfuscated fallback)', () => {
  it('writes obfuscatedFallback=true when allowLegacyFallback is set and no passphrase given', async () => {
    const warnings: string[] = [];
    const store = new EncryptedFileStore(TEST_PATH, {
      allowLegacyFallback: true,
      onWarn: (m) => warnings.push(m),
    });
    await store.set('K', 'v');

    const parsed = JSON.parse(readFileSync(TEST_PATH, 'utf-8'));
    expect(parsed.version).toBe(2);
    expect(parsed.obfuscatedFallback).toBe(true);
    expect(warnings.some((m) => m.includes('legacy hostname-derived key'))).toBe(true);
  });

  it('reads obfuscatedFallback v2 without a passphrase (and warns)', async () => {
    const writer = new EncryptedFileStore(TEST_PATH, { allowLegacyFallback: true });
    await writer.set('K', 'v');

    const warnings: string[] = [];
    const reader = new EncryptedFileStore(TEST_PATH, { onWarn: (m) => warnings.push(m) });
    expect(await reader.get('K')).toBe('v');
    expect(warnings.some((m) => m.includes('obfuscation'))).toBe(true);
  });

  it('warns only once per instance on repeated reads', async () => {
    const writer = new EncryptedFileStore(TEST_PATH, { allowLegacyFallback: true });
    await writer.set('K', 'v');

    const warnings: string[] = [];
    const reader = new EncryptedFileStore(TEST_PATH, { onWarn: (m) => warnings.push(m) });
    await reader.get('K');
    await reader.get('K');
    await reader.list();
    const obfWarnings = warnings.filter((m) => m.includes('obfuscation'));
    expect(obfWarnings.length).toBe(1);
  });

  it('preserves obfuscatedFallback mode across writes', async () => {
    const store = new EncryptedFileStore(TEST_PATH, { allowLegacyFallback: true });
    await store.set('K1', 'v1');
    await store.set('K2', 'v2');

    const parsed = JSON.parse(readFileSync(TEST_PATH, 'utf-8'));
    expect(parsed.obfuscatedFallback).toBe(true);
  });

  it('rejects cold-store writes without passphrase or fallback', async () => {
    const store = new EncryptedFileStore(TEST_PATH);
    await expect(store.set('K', 'v')).rejects.toThrow(/No passphrase provided/);
  });
});

describe('EncryptedFileStore (v1 backward-compat + migration)', () => {
  it('reads a legacy v1 payload with hostname-derived key', async () => {
    writeLegacyV1(TEST_PATH, { LEGACY_KEY: 'legacy-value' });

    const warnings: string[] = [];
    const reader = new EncryptedFileStore(TEST_PATH, { onWarn: (m) => warnings.push(m) });
    expect(await reader.get('LEGACY_KEY')).toBe('legacy-value');
    expect(warnings.some((m) => m.includes('legacy v1'))).toBe(true);
  });

  it('migrates v1 → v2 on first write (auto-migration)', async () => {
    writeLegacyV1(TEST_PATH, { OLD_KEY: 'old-value' });

    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'new-pass' });
    await store.set('NEW_KEY', 'new-value');

    const parsed = JSON.parse(readFileSync(TEST_PATH, 'utf-8'));
    expect(parsed.version).toBe(2);
    expect(parsed.obfuscatedFallback).toBeUndefined();

    // Both old and new values survive the migration.
    const reader = new EncryptedFileStore(TEST_PATH, { passphrase: 'new-pass' });
    expect(await reader.get('OLD_KEY')).toBe('old-value');
    expect(await reader.get('NEW_KEY')).toBe('new-value');
  });

  it('migrates v1 → v2 obfuscatedFallback when user picks empty passphrase', async () => {
    writeLegacyV1(TEST_PATH, { OLD_KEY: 'old-value' });

    const store = new EncryptedFileStore(TEST_PATH, { allowLegacyFallback: true });
    await store.set('NEW_KEY', 'new-value');

    const parsed = JSON.parse(readFileSync(TEST_PATH, 'utf-8'));
    expect(parsed.version).toBe(2);
    expect(parsed.obfuscatedFallback).toBe(true);

    const reader = new EncryptedFileStore(TEST_PATH);
    expect(await reader.get('OLD_KEY')).toBe('old-value');
    expect(await reader.get('NEW_KEY')).toBe('new-value');
  });
});

describe('EncryptedFileStore (kdfParams validation)', () => {
  function seedV2(kdfParams: Record<string, unknown>): void {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_PATH, JSON.stringify({
      version: 2,
      salt: randomBytes(16).toString('base64'),
      iv: randomBytes(12).toString('base64'),
      tag: Buffer.alloc(16).toString('base64'),
      data: Buffer.alloc(0).toString('base64'),
      kdfParams,
    }), 'utf-8');
  }

  it('rejects pathological N (too high → OOM defense)', async () => {
    seedV2({ algorithm: 'scrypt', N: 1 << 25, r: 8, p: 1, keyLength: 32 });
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await expect(store.get('K')).rejects.toThrow(/Invalid kdfParams\.N/);
  });

  it('rejects non-power-of-two N', async () => {
    seedV2({ algorithm: 'scrypt', N: 100000, r: 8, p: 1, keyLength: 32 });
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await expect(store.get('K')).rejects.toThrow(/Invalid kdfParams\.N/);
  });

  it('rejects unsupported KDF algorithm', async () => {
    seedV2({ algorithm: 'argon2id', N: 131072, r: 8, p: 1, keyLength: 32 });
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await expect(store.get('K')).rejects.toThrow(/Unsupported KDF algorithm/);
  });

  it('rejects wrong keyLength', async () => {
    seedV2({ algorithm: 'scrypt', N: 131072, r: 8, p: 1, keyLength: 64 });
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await expect(store.get('K')).rejects.toThrow(/kdfParams\.keyLength/);
  });
});

describe('EncryptedFileStore (derived-key cache)', () => {
  it('reuses a cached key across read-then-write within one set call', async () => {
    // With N=131072, each scrypt derivation costs ~400ms. A `set` call does
    // read() then write() — without the cache that's 2 derivations; with
    // it, just 1. Measure the set() time against a rough threshold that
    // comfortably exceeds one derivation but is under two.
    const writer = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await writer.set('SEED', 'seed-value'); // prime the file (1 derivation)

    const t0 = Date.now();
    await writer.set('NEXT', 'next-value'); // read + write on same instance
    const elapsed = Date.now() - t0;

    // Two derivations would be ~800ms. One is ~400ms. Give a cushion.
    expect(elapsed).toBeLessThan(650);
  });
});

describe('inspectSecretsFile', () => {
  it('returns absent for missing file', () => {
    expect(inspectSecretsFile(TEST_PATH)).toEqual({
      exists: false,
      obfuscatedFallback: false,
      mode: 'absent',
    });
  });

  it('detects v1 stores as hostname-obfuscated', () => {
    writeLegacyV1(TEST_PATH, { K: 'v' });
    expect(inspectSecretsFile(TEST_PATH)).toEqual({
      exists: true,
      version: 1,
      obfuscatedFallback: true,
      mode: 'hostname-obfuscated',
    });
  });

  it('detects v2 passphrase-protected stores', async () => {
    const store = new EncryptedFileStore(TEST_PATH, { passphrase: 'hunter2' });
    await store.set('K', 'v');
    const status = inspectSecretsFile(TEST_PATH);
    expect(status.version).toBe(2);
    expect(status.obfuscatedFallback).toBe(false);
    expect(status.mode).toBe('passphrase');
  });

  it('detects v2 obfuscatedFallback stores', async () => {
    const store = new EncryptedFileStore(TEST_PATH, { allowLegacyFallback: true });
    await store.set('K', 'v');
    const status = inspectSecretsFile(TEST_PATH);
    expect(status.version).toBe(2);
    expect(status.obfuscatedFallback).toBe(true);
    expect(status.mode).toBe('hostname-obfuscated');
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

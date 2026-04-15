import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedFileSecretsSession, MemorySecretsSession } from './secrets-session.js';

let dir: string;
let secretsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-secrets-session-'));
  secretsPath = join(dir, 'secrets.enc');
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('EncryptedFileSecretsSession', () => {
  it('treats an absent store as not requiring a passphrase', () => {
    const s = new EncryptedFileSecretsSession(secretsPath);
    expect(s.inspect().mode).toBe('absent');
    expect(s.requiresPassphrase()).toBe(false);
    expect(s.isUnlocked()).toBe(true);
  });

  it('round-trips a secret through a hostname-obfuscated store', async () => {
    const s = new EncryptedFileSecretsSession(secretsPath);
    await s.setSecret('MY_KEY', 'abc');
    expect(await s.listNames()).toEqual(['MY_KEY']);
    expect(s.inspect().exists).toBe(true);

    const reopened = new EncryptedFileSecretsSession(secretsPath);
    expect(await reopened.listNames()).toEqual(['MY_KEY']);
  });

  it('requires unlock for a passphrase-protected store and rejects bad passphrases', async () => {
    // Seed a passphrase-protected store via a session that already knows the passphrase.
    // Simplest way without reaching into core internals: set SUA_SECRETS_PASSPHRASE
    // for the initial write, then clear it and prove the session blocks reads.
    const prev = process.env.SUA_SECRETS_PASSPHRASE;
    try {
      process.env.SUA_SECRETS_PASSPHRASE = 'correct';
      const writer = new EncryptedFileSecretsSession(secretsPath);
      await writer.setSecret('API_KEY', 'sk-1');
    } finally {
      process.env.SUA_SECRETS_PASSPHRASE = prev;
    }

    const s = new EncryptedFileSecretsSession(secretsPath);
    expect(s.requiresPassphrase()).toBe(true);
    expect(s.isUnlocked()).toBe(false);
    expect(await s.listNames()).toEqual([]);

    expect(await s.unlock('wrong')).toBe(false);
    expect(s.isUnlocked()).toBe(false);

    expect(await s.unlock('correct')).toBe(true);
    expect(s.isUnlocked()).toBe(true);
    expect(await s.listNames()).toEqual(['API_KEY']);

    s.lock();
    expect(s.isUnlocked()).toBe(false);
    expect(await s.listNames()).toEqual([]);
  });

  it('throws on write when the passphrase-protected store is locked', async () => {
    const prev = process.env.SUA_SECRETS_PASSPHRASE;
    try {
      process.env.SUA_SECRETS_PASSPHRASE = 'pp';
      const writer = new EncryptedFileSecretsSession(secretsPath);
      await writer.setSecret('SEED', 'v');
    } finally {
      process.env.SUA_SECRETS_PASSPHRASE = prev;
    }

    const s = new EncryptedFileSecretsSession(secretsPath);
    await expect(s.setSecret('OTHER', 'v')).rejects.toThrow(/locked/i);
  });
});

describe('MemorySecretsSession', () => {
  it('simulates a passphrase-protected store that unlocks on the correct passphrase', async () => {
    const s = new MemorySecretsSession({
      status: { exists: true, version: 2, obfuscatedFallback: false, mode: 'passphrase' },
      correctPassphrase: 'ok',
    });
    expect(s.isUnlocked()).toBe(false);
    expect(await s.unlock('nope')).toBe(false);
    expect(await s.unlock('ok')).toBe(true);
    expect(s.isUnlocked()).toBe(true);
  });

  it('throws on set/delete while locked', async () => {
    const s = new MemorySecretsSession({
      status: { exists: true, version: 2, obfuscatedFallback: false, mode: 'passphrase' },
      correctPassphrase: 'ok',
    });
    await expect(s.setSecret('X', 'v')).rejects.toThrow(/locked/i);
    await expect(s.deleteSecret('X')).rejects.toThrow(/locked/i);
  });
});

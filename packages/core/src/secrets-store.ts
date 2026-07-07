import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { chmod600Safe } from './fs-utils.js';

/** Filename of the stable machine key that seeds the obfuscated fallback. */
const MACHINE_KEY_FILE = '.secrets-machine-key';

export interface SecretsStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
  has(name: string): Promise<boolean>;
  getAll(): Promise<Record<string, string>>;
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const LEGACY_V1_SALT = 'sua-secrets-v1';
// scrypt at N=2^17, r=8 needs ~128MB; bump ceiling so Node doesn't reject the call.
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export interface KdfParams {
  algorithm: 'scrypt';
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

// OWASP 2024 recommended scrypt minimum. Stored in the payload so we can raise
// these later without breaking old stores — readers honor whatever the file says.
const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'scrypt',
  N: 131072, // 2^17
  r: 8,
  p: 1,
  keyLength: KEY_LENGTH,
};

// Bounds on KDF params read from a payload. Defends against an adversarial
// secrets.enc with pathological N that would OOM / hang the process at read
// time. These are generous — raising DEFAULT_KDF_PARAMS.N later is fine.
const MIN_SCRYPT_N = 1 << 14; // 16384, Node's default minimum work factor
const MAX_SCRYPT_N = 1 << 20; // ~1M — well above what real stores need
const MAX_SCRYPT_R = 16;
const MAX_SCRYPT_P = 4;

interface EncryptedPayloadV1 {
  version: 1;
  iv: string;
  tag: string;
  data: string;
}

interface EncryptedPayloadV2 {
  version: 2;
  salt: string;
  iv: string;
  tag: string;
  data: string;
  kdfParams: KdfParams;
  // When true, the "passphrase" fed into scrypt is the hostname+username seed
  // (same as v1). This is obfuscation, not encryption. Readers warn on every load.
  obfuscatedFallback?: boolean;
}

type EncryptedPayload = EncryptedPayloadV1 | EncryptedPayloadV2;

interface SecretsData {
  [name: string]: string;
}

export type SecretsSecurityMode = 'passphrase' | 'hostname-obfuscated' | 'absent';

export interface SecretsStoreStatus {
  exists: boolean;
  version?: 1 | 2;
  obfuscatedFallback: boolean;
  mode: SecretsSecurityMode;
}

/**
 * Inspect the secrets file header without decrypting. Safe to call without a
 * passphrase — returns mode='absent' for missing/unparseable files.
 */
export function inspectSecretsFile(filePath: string): SecretsStoreStatus {
  if (!existsSync(filePath)) {
    return { exists: false, obfuscatedFallback: false, mode: 'absent' };
  }
  try {
    const payload = JSON.parse(readFileSync(filePath, 'utf-8')) as EncryptedPayload;
    if (payload.version === 1) {
      return { exists: true, version: 1, obfuscatedFallback: true, mode: 'hostname-obfuscated' };
    }
    if (payload.version === 2) {
      const obf = payload.obfuscatedFallback === true;
      return {
        exists: true,
        version: 2,
        obfuscatedFallback: obf,
        mode: obf ? 'hostname-obfuscated' : 'passphrase',
      };
    }
  } catch {
    // Unparseable — surface as exists-but-unknown so callers can prompt/fail.
  }
  return { exists: true, obfuscatedFallback: false, mode: 'absent' };
}

export interface EncryptedFileStoreOptions {
  /**
   * Passphrase to derive the encryption key. An empty string is treated as an
   * explicit request for the legacy hostname-derived fallback. If omitted,
   * reads SUA_SECRETS_PASSPHRASE from the environment.
   */
  passphrase?: string;
  /**
   * When true, and no passphrase is otherwise available, writes use the
   * legacy hostname-derived key (obfuscatedFallback=true in the payload).
   * Reads fall back automatically based on the payload flag regardless.
   */
  allowLegacyFallback?: boolean;
  /** Warning sink. Defaults to console.error. Override for tests. */
  onWarn?: (message: string) => void;
}

export class EncryptedFileStore implements SecretsStore {
  private readonly path: string;
  private readonly passphrase: string | undefined;
  private readonly allowLegacyFallback: boolean;
  private readonly onWarn: (message: string) => void;
  private warnedObfuscated = false;
  private warnedV1 = false;
  // Instance-level cache of the last scrypt result. Keyed by the tuple of
  // (saltB64, paramsJSON, passphraseInput) so a mismatched call always
  // re-derives. Collapses the read-then-write scrypt in set/delete from
  // two derivations to one.
  private keyCache: { key: string; buffer: Buffer } | undefined;

  constructor(filePath: string, options: EncryptedFileStoreOptions = {}) {
    this.path = filePath;
    this.passphrase = resolvePassphrase(options.passphrase);
    this.allowLegacyFallback = options.allowLegacyFallback === true;
    this.onWarn = options.onWarn ?? ((m) => console.error(m));

    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  async get(name: string): Promise<string | undefined> {
    return this.read()[name];
  }

  async set(name: string, value: string): Promise<void> {
    const data = this.read();
    data[name] = value;
    this.write(data);
  }

  async delete(name: string): Promise<void> {
    const data = this.read();
    delete data[name];
    this.write(data);
  }

  async list(): Promise<string[]> {
    return Object.keys(this.read()).sort();
  }

  async has(name: string): Promise<boolean> {
    return name in this.read();
  }

  async getAll(): Promise<Record<string, string>> {
    return { ...this.read() };
  }

  private read(): SecretsData {
    if (!existsSync(this.path)) return {};

    let payload: EncryptedPayload;
    try {
      payload = JSON.parse(readFileSync(this.path, 'utf-8')) as EncryptedPayload;
    } catch (err) {
      throw new Error(
        `Failed to parse secrets store at ${this.path}: ${(err as Error).message}`,
      );
    }

    if (payload.version === 1) return this.decryptV1(payload);
    if (payload.version === 2) return this.decryptV2(payload);
    throw new Error(
      `Unsupported secrets version: ${(payload as { version: unknown }).version}`,
    );
  }

  private decryptV1(payload: EncryptedPayloadV1): SecretsData {
    if (!this.warnedV1) {
      this.onWarn(
        `⚠  Secrets store at ${this.path} is legacy v1 (hostname-obfuscated, not encrypted). ` +
          `Run 'sua secrets migrate' to upgrade.`,
      );
      this.warnedV1 = true;
    }
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const encrypted = Buffer.from(payload.data, 'base64');
    const key = scryptSync(legacySeed(), LEGACY_V1_SALT, KEY_LENGTH);
    return decrypt(this.path, key, iv, tag, encrypted, 'legacy v1');
  }

  private decryptV2(payload: EncryptedPayloadV2): SecretsData {
    validateKdfParams(payload.kdfParams, this.path);

    const salt = Buffer.from(payload.salt, 'base64');
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const encrypted = Buffer.from(payload.data, 'base64');

    if (payload.obfuscatedFallback === true) {
      if (!this.warnedObfuscated) {
        this.onWarn(
          `⚠  Secrets store at ${this.path} uses the local machine key ` +
            `(obfuscation, not encryption). Run 'sua secrets migrate' to set a passphrase.`,
        );
        this.warnedObfuscated = true;
      }
      // Primary: the stable per-vault machine key. This replaced the old
      // hostname:username seed, which broke whenever os.hostname() flipped
      // (macOS does this on network changes), silently failing agent runs.
      try {
        const machineKey = this.deriveAndCache(this.machineSeed(), salt, payload.kdfParams);
        return decrypt(this.path, machineKey, iv, tag, encrypted, 'v2');
      } catch {
        // Back-compat: a vault written before the machine key existed is still
        // keyed to hostname:username. Decrypt with it, then transparently
        // re-key to the machine seed so future reads are stable (self-heal).
        let data: SecretsData;
        try {
          const legacyKey = this.deriveAndCache(legacySeed(), salt, payload.kdfParams);
          data = decrypt(this.path, legacyKey, iv, tag, encrypted, 'v2 (legacy hostname key)');
        } catch {
          throw new Error(undecryptableVaultMessage(this.path));
        }
        try { this.write(data); } catch { /* best-effort re-key; the read still succeeds */ }
        return data;
      }
    }

    if (this.passphrase === undefined || this.passphrase.length === 0) {
      throw new Error(
        `Secrets store at ${this.path} is passphrase-protected. ` +
          `Set SUA_SECRETS_PASSPHRASE in the environment (or run 'sua secrets get' interactively to enter it).`,
      );
    }
    const key = this.deriveAndCache(this.passphrase, salt, payload.kdfParams);
    try {
      return decrypt(this.path, key, iv, tag, encrypted, 'v2');
    } catch {
      throw new Error(
        `Failed to decrypt v2 secrets store at ${this.path}: wrong passphrase.`,
      );
    }
  }

  /**
   * Stable per-vault machine key seeding the obfuscated fallback. Stored next
   * to the vault (0600), generated once. Replaces the old hostname:username
   * seed so a hostname change can't lock an operator out of their own secrets.
   * Still "obfuscation, not encryption" — use a passphrase for real security.
   */
  private machineSeed(): string {
    const keyPath = join(dirname(this.path), MACHINE_KEY_FILE);
    try {
      if (existsSync(keyPath)) {
        const v = readFileSync(keyPath, 'utf-8').trim();
        if (v) return v;
      }
    } catch { /* unreadable — fall through and regenerate */ }
    const key = randomBytes(KEY_LENGTH).toString('base64');
    try {
      mkdirSync(dirname(keyPath), { recursive: true });
      writeFileSync(keyPath, key + '\n', 'utf-8');
      chmod600Safe(keyPath);
    } catch { /* best-effort persist; an ephemeral key still works for this process */ }
    return key;
  }

  private write(data: SecretsData): void {
    const existing = existsSync(this.path) ? this.parseExistingPayload() : undefined;

    let salt: Buffer;
    let kdfParams: KdfParams;
    let obfuscatedFallback: boolean;

    if (existing && existing.version === 2) {
      // Preserve the existing store's security mode and KDF parameters.
      salt = Buffer.from(existing.salt, 'base64');
      kdfParams = existing.kdfParams;
      obfuscatedFallback = existing.obfuscatedFallback === true;
      if (!obfuscatedFallback && (this.passphrase === undefined || this.passphrase.length === 0)) {
        throw new Error(
          `Cannot write to passphrase-protected store at ${this.path} without a passphrase.`,
        );
      }
    } else {
      // Cold store, v1-being-migrated, or unparseable — mint fresh v2 params.
      if (!this.hasUsablePassphrase() && !this.allowLegacyFallback) {
        throw new Error(
          `No passphrase provided for secrets store at ${this.path}. ` +
            `Set SUA_SECRETS_PASSPHRASE, or set it to the empty string to accept the legacy hostname-derived fallback.`,
        );
      }
      salt = randomBytes(SALT_LENGTH);
      kdfParams = { ...DEFAULT_KDF_PARAMS };
      obfuscatedFallback = !this.hasUsablePassphrase();
    }

    const passphraseInput = obfuscatedFallback ? this.machineSeed() : this.passphrase!;
    if (obfuscatedFallback && !this.warnedObfuscated) {
      this.onWarn(
        `⚠  Writing secrets with the local machine key (obfuscation, not encryption). ` +
          `Run 'sua secrets migrate' to set a passphrase.`,
      );
      this.warnedObfuscated = true;
    }

    const key = this.deriveAndCache(passphraseInput, salt, kdfParams);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload: EncryptedPayloadV2 = {
      version: 2,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64'),
      kdfParams,
      ...(obfuscatedFallback ? { obfuscatedFallback: true } : {}),
    };

    writeFileSync(this.path, JSON.stringify(payload, null, 2), 'utf-8');
    chmod600Safe(this.path);
  }

  private parseExistingPayload(): EncryptedPayload | undefined {
    try {
      return JSON.parse(readFileSync(this.path, 'utf-8')) as EncryptedPayload;
    } catch {
      return undefined;
    }
  }

  private hasUsablePassphrase(): boolean {
    return this.passphrase !== undefined && this.passphrase.length > 0;
  }

  private deriveAndCache(passphrase: string, salt: Buffer, params: KdfParams): Buffer {
    const cacheKey = `${salt.toString('base64')}|${JSON.stringify(params)}|${passphrase}`;
    if (this.keyCache && this.keyCache.key === cacheKey) return this.keyCache.buffer;
    const buffer = deriveKey(passphrase, salt, params);
    this.keyCache = { key: cacheKey, buffer };
    return buffer;
  }
}

function validateKdfParams(params: KdfParams, path: string): void {
  if (params.algorithm !== 'scrypt') {
    throw new Error(`Unsupported KDF algorithm "${params.algorithm}" in ${path}.`);
  }
  if (params.keyLength !== KEY_LENGTH) {
    throw new Error(`Invalid kdfParams.keyLength (${params.keyLength}) in ${path}; must be ${KEY_LENGTH}.`);
  }
  if (!Number.isInteger(params.N) || params.N < MIN_SCRYPT_N || params.N > MAX_SCRYPT_N || (params.N & (params.N - 1)) !== 0) {
    throw new Error(
      `Invalid kdfParams.N (${params.N}) in ${path}; must be a power of 2 in [${MIN_SCRYPT_N}, ${MAX_SCRYPT_N}].`,
    );
  }
  if (!Number.isInteger(params.r) || params.r < 1 || params.r > MAX_SCRYPT_R) {
    throw new Error(`Invalid kdfParams.r (${params.r}) in ${path}; must be in [1, ${MAX_SCRYPT_R}].`);
  }
  if (!Number.isInteger(params.p) || params.p < 1 || params.p > MAX_SCRYPT_P) {
    throw new Error(`Invalid kdfParams.p (${params.p}) in ${path}; must be in [1, ${MAX_SCRYPT_P}].`);
  }
}

function resolvePassphrase(explicit: string | undefined): string | undefined {
  if (explicit !== undefined) return explicit;
  const envPass = process.env.SUA_SECRETS_PASSPHRASE;
  if (envPass !== undefined && envPass.length > 0) return envPass;
  return undefined;
}

/** Legacy seed — hostname:username. Kept ONLY to read (and then re-key) vaults
 * written before the stable machine key existed. Never used for new writes. */
function legacySeed(): string {
  return `${hostname()}:${userInfo().username}`;
}

/** Actionable message when neither the machine key nor the legacy hostname key
 * can decrypt an obfuscated vault (the vault is intact — the key is gone). */
function undecryptableVaultMessage(path: string): string {
  return (
    `Could not decrypt the secrets vault at ${path}. The file is not corrupted — ` +
    `the machine identity that wrote it is no longer available (most often the ` +
    `hostname changed). Recover by restoring a backup of this file, or re-enter ` +
    `secrets with 'sua secrets set <NAME>'. To make this permanent, migrate to a ` +
    `passphrase: 'sua secrets migrate'.`
  );
}

function deriveKey(passphrase: string, salt: Buffer, params: KdfParams): Buffer {
  if (params.algorithm !== 'scrypt') {
    throw new Error(`Unsupported KDF algorithm: ${params.algorithm}`);
  }
  return scryptSync(passphrase, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

function decrypt(
  path: string,
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
  encrypted: Buffer,
  label: string,
): SecretsData {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plain.toString('utf-8')) as SecretsData;
  } catch (err) {
    throw new Error(
      `Failed to decrypt ${label} secrets store at ${path}: ${(err as Error).message}`,
    );
  }
}

/**
 * In-memory secrets store for tests and CI environments.
 */
export class MemorySecretsStore implements SecretsStore {
  private readonly data = new Map<string, string>();

  async get(name: string): Promise<string | undefined> {
    return this.data.get(name);
  }

  async set(name: string, value: string): Promise<void> {
    this.data.set(name, value);
  }

  async delete(name: string): Promise<void> {
    this.data.delete(name);
  }

  async list(): Promise<string[]> {
    return Array.from(this.data.keys()).sort();
  }

  async has(name: string): Promise<boolean> {
    return this.data.has(name);
  }

  async getAll(): Promise<Record<string, string>> {
    return Object.fromEntries(this.data);
  }
}

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname, userInfo } from 'node:os';

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
const TAG_LENGTH = 16;
const SALT = 'sua-secrets-v1';

interface EncryptedPayload {
  version: 1;
  iv: string;
  tag: string;
  data: string;
}

interface SecretsData {
  [name: string]: string;
}

export class EncryptedFileStore implements SecretsStore {
  private readonly path: string;
  private readonly key: Buffer;

  constructor(filePath: string) {
    this.path = filePath;
    this.key = deriveKey();

    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  async get(name: string): Promise<string | undefined> {
    const data = this.read();
    return data[name];
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
    const data = this.read();
    return name in data;
  }

  async getAll(): Promise<Record<string, string>> {
    return { ...this.read() };
  }

  private read(): SecretsData {
    if (!existsSync(this.path)) return {};

    try {
      const raw = readFileSync(this.path, 'utf-8');
      const payload = JSON.parse(raw) as EncryptedPayload;

      if (payload.version !== 1) {
        throw new Error(`Unsupported secrets version: ${payload.version}`);
      }

      const iv = Buffer.from(payload.iv, 'base64');
      const tag = Buffer.from(payload.tag, 'base64');
      const encrypted = Buffer.from(payload.data, 'base64');

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return JSON.parse(decrypted.toString('utf-8')) as SecretsData;
    } catch (err) {
      throw new Error(
        `Failed to read secrets store at ${this.path}: ${(err as Error).message}. ` +
        `The file may be corrupted or encrypted with a different key (different user/hostname).`
      );
    }
  }

  private write(data: SecretsData): void {
    const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload: EncryptedPayload = {
      version: 1,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64'),
    };

    writeFileSync(this.path, JSON.stringify(payload, null, 2), 'utf-8');
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Best effort: chmod may fail on Windows or network mounts
    }
  }
}

function deriveKey(): Buffer {
  const seed = `${hostname()}:${userInfo().username}`;
  return scryptSync(seed, SALT, KEY_LENGTH);
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

import {
  EncryptedFileStore,
  inspectSecretsFile,
  MemorySecretsStore,
  type SecretsStore,
  type SecretsStoreStatus,
} from '@some-useful-agents/core';

/**
 * Dashboard-side wrapper around the secrets store. Adds a session-cached
 * passphrase so the UI can unlock once per dashboard process and
 * subsequent writes skip re-prompting. The cache lives in process memory
 * only — never persisted to disk, cleared on shutdown.
 *
 * Reads that don't need decryption (inspect) work regardless of unlock
 * state; list/set/delete throw when the underlying store is passphrase-
 * protected and the session is still locked.
 */
export interface SecretsSession {
  /** Current on-disk status (file exists? mode?). Never decrypts. */
  inspect(): SecretsStoreStatus;
  /** Whether a user-supplied passphrase is required for writes/reads. */
  requiresPassphrase(): boolean;
  /** Whether the session currently has what it needs to read + write. */
  isUnlocked(): boolean;
  /** Attempt to unlock using `pass`. Returns true on success. */
  unlock(pass: string): Promise<boolean>;
  /** Clear the cached passphrase. */
  lock(): void;
  /** List declared secret names. Returns [] if locked or absent. */
  listNames(): Promise<string[]>;
  /** Write a secret. Throws if locked or mode requires a passphrase we lack. */
  setSecret(name: string, value: string): Promise<void>;
  /** Delete a secret. Throws if locked. */
  deleteSecret(name: string): Promise<void>;
}

/**
 * Production session backed by the encrypted file store at `secretsPath`.
 * Reads `inspect()` from the file header on every call — so an external
 * `sua secrets migrate` (or manual file swap) is reflected immediately.
 */
export class EncryptedFileSecretsSession implements SecretsSession {
  private passphrase: string | undefined;

  constructor(private readonly secretsPath: string) {}

  inspect(): SecretsStoreStatus {
    return inspectSecretsFile(this.secretsPath);
  }

  requiresPassphrase(): boolean {
    return this.inspect().mode === 'passphrase';
  }

  isUnlocked(): boolean {
    if (!this.requiresPassphrase()) return true;
    return this.passphrase !== undefined;
  }

  async unlock(pass: string): Promise<boolean> {
    if (pass.length === 0) return false;
    try {
      const probe = new EncryptedFileStore(this.secretsPath, { passphrase: pass });
      await probe.list();
      this.passphrase = pass;
      return true;
    } catch {
      return false;
    }
  }

  lock(): void {
    this.passphrase = undefined;
  }

  async listNames(): Promise<string[]> {
    const store = this.readStore();
    if (!store) return [];
    return store.list();
  }

  async setSecret(name: string, value: string): Promise<void> {
    await this.writeStore().set(name, value);
  }

  async deleteSecret(name: string): Promise<void> {
    await this.writeStore().delete(name);
  }

  private readStore(): EncryptedFileStore | undefined {
    const status = this.inspect();
    if (!status.exists) return undefined;
    if (status.mode === 'passphrase') {
      if (!this.passphrase) return undefined;
      return new EncryptedFileStore(this.secretsPath, { passphrase: this.passphrase });
    }
    // hostname-obfuscated: readable with no passphrase
    return new EncryptedFileStore(this.secretsPath, { onWarn: () => {} });
  }

  private writeStore(): EncryptedFileStore {
    const status = this.inspect();
    if (status.mode === 'passphrase') {
      if (!this.passphrase) {
        throw new Error('Secrets store is locked. Unlock it before writing.');
      }
      return new EncryptedFileStore(this.secretsPath, { passphrase: this.passphrase });
    }
    // Absent or hostname-obfuscated: allow legacy-fallback writes so a
    // fresh install without a passphrase can still store a secret. The
    // underlying store emits its own warning on first write.
    return new EncryptedFileStore(this.secretsPath, {
      allowLegacyFallback: true,
      onWarn: () => {},
    });
  }
}

/**
 * Test-friendly session. `status` is mutable so tests can simulate a
 * passphrase-protected store without writing a real `secrets.enc`.
 * `correctPassphrase` is the value `unlock()` accepts; `undefined`
 * means unlock always fails.
 */
export class MemorySecretsSession implements SecretsSession {
  private readonly backing: SecretsStore;
  private unlocked: boolean;
  public status: SecretsStoreStatus;

  constructor(opts: {
    backing?: SecretsStore;
    status?: SecretsStoreStatus;
    correctPassphrase?: string;
  } = {}) {
    this.backing = opts.backing ?? new MemorySecretsStore();
    this.status = opts.status ?? { exists: false, obfuscatedFallback: false, mode: 'absent' };
    this.unlocked = this.status.mode !== 'passphrase';
    this.correctPassphrase = opts.correctPassphrase;
  }

  private readonly correctPassphrase: string | undefined;

  inspect(): SecretsStoreStatus {
    return this.status;
  }

  requiresPassphrase(): boolean {
    return this.status.mode === 'passphrase';
  }

  isUnlocked(): boolean {
    return !this.requiresPassphrase() || this.unlocked;
  }

  async unlock(pass: string): Promise<boolean> {
    if (this.correctPassphrase === undefined) return false;
    if (pass === this.correctPassphrase) {
      this.unlocked = true;
      return true;
    }
    return false;
  }

  lock(): void {
    this.unlocked = false;
  }

  async listNames(): Promise<string[]> {
    if (!this.isUnlocked()) return [];
    return this.backing.list();
  }

  async setSecret(name: string, value: string): Promise<void> {
    if (!this.isUnlocked()) {
      throw new Error('Secrets store is locked.');
    }
    await this.backing.set(name, value);
    // Writing transitions an 'absent' store to 'passphrase' mode in
    // reality; mirror that here so tests see the real flow.
    if (this.status.mode === 'absent') {
      this.status = { exists: true, version: 2, obfuscatedFallback: false, mode: 'hostname-obfuscated' };
    }
  }

  async deleteSecret(name: string): Promise<void> {
    if (!this.isUnlocked()) {
      throw new Error('Secrets store is locked.');
    }
    await this.backing.delete(name);
  }
}

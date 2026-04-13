import type { Provider } from '@some-useful-agents/core';
import { LocalProvider, EncryptedFileStore } from '@some-useful-agents/core';
import type { SuaConfig } from './config.js';
import { getDbPath, getSecretsPath, getRetentionDays, resolveProvider } from './config.js';

export interface CreateProviderOptions {
  /** Override which provider to use; normally resolved from config / env. */
  providerOverride?: string;
  /**
   * Names of community shell agents explicitly permitted to run during
   * this process's lifetime. Sourced from repeated `--allow-untrusted-shell`
   * CLI flags.
   */
  allowUntrustedShell?: ReadonlySet<string>;
}

export async function createProvider(
  config: SuaConfig,
  options: CreateProviderOptions | string = {},
): Promise<Provider> {
  // Accept a bare string for backwards compat with the previous signature
  // (`createProvider(config, overrideString)`); prefer the options object.
  const opts: CreateProviderOptions = typeof options === 'string'
    ? { providerOverride: options }
    : options;

  const kind = resolveProvider(config, opts.providerOverride);
  const secretsStore = new EncryptedFileStore(getSecretsPath(config));
  const allowUntrustedShell = opts.allowUntrustedShell ?? new Set<string>();
  const retentionDays = getRetentionDays(config);

  if (kind === 'local') {
    const provider = new LocalProvider(getDbPath(config), secretsStore, {
      allowUntrustedShell,
      retentionDays,
    });
    await provider.initialize();
    return provider;
  }

  // Dynamic import to avoid loading Temporal SDK when not needed
  const { TemporalProvider } = await import('@some-useful-agents/temporal-provider');
  const provider = new TemporalProvider({
    dbPath: getDbPath(config),
    secretsPath: getSecretsPath(config),
    address: config.temporalAddress,
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    allowUntrustedShell,
    retentionDays,
  });
  await provider.initialize();
  return provider;
}

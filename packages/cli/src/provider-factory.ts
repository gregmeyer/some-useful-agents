import type { Provider } from '@some-useful-agents/core';
import { LocalProvider, EncryptedFileStore } from '@some-useful-agents/core';
import type { SuaConfig } from './config.js';
import { getDbPath, getSecretsPath, resolveProvider } from './config.js';

export async function createProvider(config: SuaConfig, override?: string): Promise<Provider> {
  const kind = resolveProvider(config, override);
  const secretsStore = new EncryptedFileStore(getSecretsPath(config));

  if (kind === 'local') {
    const provider = new LocalProvider(getDbPath(config), secretsStore);
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
  });
  await provider.initialize();
  return provider;
}

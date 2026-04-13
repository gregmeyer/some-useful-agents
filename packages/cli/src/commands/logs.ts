import { Command } from 'commander';
import { LocalProvider, EncryptedFileStore } from '@some-useful-agents/core';
import { loadConfig, getDbPath, getSecretsPath } from '../config.js';
import * as ui from '../ui.js';

export const logsCommand = new Command('logs')
  .description('Show logs for a run')
  .argument('<runId>', 'Run ID')
  .action(async (runId: string) => {
    const config = loadConfig();
    const secretsStore = new EncryptedFileStore(getSecretsPath(config));
    const provider = new LocalProvider(getDbPath(config), secretsStore);
    await provider.initialize();

    try {
      const logs = await provider.getRunLogs(runId);
      if (!logs || logs === '(no output)') {
        ui.info('No output for this run.');
      } else {
        ui.outputFrame(logs);
      }
    } finally {
      await provider.shutdown();
    }
  });

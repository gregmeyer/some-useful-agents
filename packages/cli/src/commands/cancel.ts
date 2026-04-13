import { Command } from 'commander';
import { LocalProvider, EncryptedFileStore } from '@some-useful-agents/core';
import { loadConfig, getDbPath, getSecretsPath } from '../config.js';
import * as ui from '../ui.js';

export const cancelCommand = new Command('cancel')
  .description('Cancel a running agent')
  .argument('<runId>', 'Run ID')
  .action(async (runId: string) => {
    const config = loadConfig();
    const secretsStore = new EncryptedFileStore(getSecretsPath(config));
    const provider = new LocalProvider(getDbPath(config), secretsStore);
    await provider.initialize();

    try {
      const run = await provider.getRun(runId);
      if (!run) {
        ui.fail(`Run "${runId}" not found.`);
        process.exit(1);
      }
      if (run.status !== 'running' && run.status !== 'pending') {
        ui.warn(`Run is already ${run.status}.`);
        return;
      }

      await provider.cancelRun(runId);
      ui.ok(`Cancelled run ${ui.id(runId.slice(0, 8))}.`);
    } finally {
      await provider.shutdown();
    }
  });

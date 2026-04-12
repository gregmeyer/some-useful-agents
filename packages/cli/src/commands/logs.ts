import { Command } from 'commander';
import chalk from 'chalk';
import { LocalProvider, EncryptedFileStore } from '@some-useful-agents/core';
import { loadConfig, getDbPath, getSecretsPath } from '../config.js';

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
        console.log(chalk.dim('No output for this run.'));
      } else {
        console.log(logs);
      }
    } finally {
      await provider.shutdown();
    }
  });

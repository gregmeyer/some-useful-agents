import { Command } from 'commander';
import chalk from 'chalk';
import { LocalProvider, EncryptedFileStore } from '@some-useful-agents/core';
import { loadConfig, getDbPath, getSecretsPath } from '../config.js';

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
        console.error(chalk.red(`Run "${runId}" not found.`));
        process.exit(1);
      }
      if (run.status !== 'running' && run.status !== 'pending') {
        console.log(chalk.yellow(`Run is already ${run.status}.`));
        return;
      }

      await provider.cancelRun(runId);
      console.log(chalk.green(`Cancelled run ${chalk.dim(runId.slice(0, 8))}.`));
    } finally {
      await provider.shutdown();
    }
  });

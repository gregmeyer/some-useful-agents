import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadAgents, LocalProvider, EncryptedFileStore } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs, getDbPath, getSecretsPath } from '../config.js';

export const runCommand = new Command('run')
  .description('Run an agent')
  .argument('<name>', 'Agent name')
  .option('--verbose', 'Show detailed output')
  .action(async (name: string, options) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.runnable });

    const agent = agents.get(name);
    if (!agent) {
      console.error(chalk.red(`Agent "${name}" not found.`));
      console.error(chalk.dim('Run "sua agent list" to see available agents.'));
      process.exit(1);
    }

    const secretsStore = new EncryptedFileStore(getSecretsPath(config));
    const provider = new LocalProvider(getDbPath(config), secretsStore);
    await provider.initialize();

    const spinner = ora(`Running ${chalk.cyan(name)}...`).start();

    try {
      const run = await provider.submitRun({ agent, triggeredBy: 'cli' });
      spinner.text = `Running ${chalk.cyan(name)} (${chalk.dim(run.id.slice(0, 8))})...`;

      // Poll for completion
      let current = run;
      while (current.status === 'running' || current.status === 'pending') {
        await new Promise(r => setTimeout(r, 250));
        const updated = await provider.getRun(run.id);
        if (updated) current = updated;
      }

      if (current.status === 'completed') {
        spinner.succeed(`${chalk.cyan(name)} completed`);
        if (current.result) {
          console.log(chalk.dim('\n--- output ---'));
          console.log(current.result.trimEnd());
          console.log(chalk.dim('--- end ---'));
        }
      } else {
        spinner.fail(`${chalk.cyan(name)} ${current.status}`);
        if (current.error) {
          console.error(chalk.red(current.error));
        }
      }

      console.log(chalk.dim(`\nRun ID: ${current.id}`));
    } finally {
      await provider.shutdown();
    }
  });

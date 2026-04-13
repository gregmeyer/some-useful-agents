import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { LocalProvider, EncryptedFileStore } from '@some-useful-agents/core';
import { loadConfig, getDbPath, getSecretsPath } from '../config.js';
import * as ui from '../ui.js';

export const statusCommand = new Command('status')
  .description('Show run status')
  .argument('[runId]', 'Specific run ID (shows all recent if omitted)')
  .option('-n, --limit <n>', 'Number of recent runs to show', '10')
  .action(async (runId?: string, options?: { limit: string }) => {
    const config = loadConfig();
    const secretsStore = new EncryptedFileStore(getSecretsPath(config));
    const provider = new LocalProvider(getDbPath(config), secretsStore);
    await provider.initialize();

    try {
      if (runId) {
        const run = await provider.getRun(runId);
        if (!run) {
          ui.fail(`Run "${runId}" not found.`);
          process.exit(1);
        }

        console.log(`\n${chalk.bold('Run')} ${ui.id(run.id)}`);
        ui.kv('Agent', ui.agent(run.agentName), 10);
        ui.kv('Status', ui.colorStatus(run.status), 10);
        ui.kv('Started', run.startedAt, 10);
        if (run.completedAt) ui.kv('Completed', run.completedAt, 10);
        if (run.exitCode !== undefined) ui.kv('Exit code', String(run.exitCode), 10);
        if (run.error) ui.kv('Error', chalk.red(run.error), 10);
      } else {
        const limit = parseInt(options?.limit ?? '10', 10);
        const runs = await provider.listRuns({ limit });

        if (runs.length === 0) {
          ui.info('No runs yet.');
          return;
        }

        const table = new Table({
          head: [chalk.bold('ID'), chalk.bold('Agent'), chalk.bold('Status'), chalk.bold('Started')],
        });

        for (const run of runs) {
          table.push([
            ui.id(run.id.slice(0, 8)),
            ui.agent(run.agentName),
            ui.colorStatus(run.status),
            run.startedAt,
          ]);
        }

        ui.section('Recent Runs');
        console.log(table.toString());
      }
    } finally {
      await provider.shutdown();
    }
  });

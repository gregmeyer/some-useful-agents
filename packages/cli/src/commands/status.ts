import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { LocalProvider } from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';

const STATUS_COLORS: Record<string, (s: string) => string> = {
  completed: chalk.green,
  running: chalk.blue,
  pending: chalk.yellow,
  failed: chalk.red,
  cancelled: chalk.gray,
};

export const statusCommand = new Command('status')
  .description('Show run status')
  .argument('[runId]', 'Specific run ID (shows all recent if omitted)')
  .option('-n, --limit <n>', 'Number of recent runs to show', '10')
  .action(async (runId?: string, options?: { limit: string }) => {
    const config = loadConfig();
    const provider = new LocalProvider(getDbPath(config));
    await provider.initialize();

    try {
      if (runId) {
        const run = await provider.getRun(runId);
        if (!run) {
          console.error(chalk.red(`Run "${runId}" not found.`));
          process.exit(1);
        }

        const colorFn = STATUS_COLORS[run.status] ?? chalk.white;
        console.log(`\n${chalk.bold('Run')} ${chalk.dim(run.id)}`);
        console.log(`  Agent:     ${chalk.cyan(run.agentName)}`);
        console.log(`  Status:    ${colorFn(run.status)}`);
        console.log(`  Started:   ${run.startedAt}`);
        if (run.completedAt) console.log(`  Completed: ${run.completedAt}`);
        if (run.exitCode !== undefined) console.log(`  Exit code: ${run.exitCode}`);
        if (run.error) console.log(`  Error:     ${chalk.red(run.error)}`);
      } else {
        const limit = parseInt(options?.limit ?? '10', 10);
        const runs = await provider.listRuns({ limit });

        if (runs.length === 0) {
          console.log(chalk.dim('No runs yet.'));
          return;
        }

        const table = new Table({
          head: [chalk.bold('ID'), chalk.bold('Agent'), chalk.bold('Status'), chalk.bold('Started')],
        });

        for (const run of runs) {
          const colorFn = STATUS_COLORS[run.status] ?? chalk.white;
          table.push([
            chalk.dim(run.id.slice(0, 8)),
            chalk.cyan(run.agentName),
            colorFn(run.status),
            run.startedAt,
          ]);
        }

        console.log(`\n${chalk.bold('Recent Runs')}\n`);
        console.log(table.toString());
      }
    } finally {
      await provider.shutdown();
    }
  });

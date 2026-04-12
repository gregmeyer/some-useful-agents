import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config.js';

export const workerCommand = new Command('worker')
  .description('Temporal worker management');

workerCommand
  .command('start')
  .description('Start the Temporal worker (runs on host, needs access to shell + Claude CLI)')
  .option('--address <address>', 'Temporal server address')
  .option('--namespace <namespace>', 'Temporal namespace')
  .option('--task-queue <queue>', 'Task queue name')
  .action(async (options) => {
    const config = loadConfig();
    const address = options.address ?? config.temporalAddress ?? 'localhost:7233';
    const namespace = options.namespace ?? config.temporalNamespace ?? 'default';
    const taskQueue = options.taskQueue ?? config.temporalTaskQueue ?? 'sua-agents';

    const { startWorker } = await import('@some-useful-agents/temporal-provider');

    console.log(chalk.bold('Starting Temporal worker...'));
    console.log(chalk.dim(`  Address:    ${address}`));
    console.log(chalk.dim(`  Namespace:  ${namespace}`));
    console.log(chalk.dim(`  Task queue: ${taskQueue}`));
    console.log('');

    try {
      const worker = await startWorker({ address, namespace, taskQueue });
      console.log(chalk.green('Worker connected. Listening for agent runs...'));
      console.log(chalk.dim('Press Ctrl+C to stop.\n'));

      process.on('SIGINT', () => {
        console.log('\nShutting down worker...');
        worker.shutdown();
      });

      await worker.run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Worker failed: ${msg}`));
      if (msg.includes('ECONNREFUSED') || msg.includes('connection refused')) {
        console.error(chalk.dim(`\nIs Temporal running? Start it with: ${chalk.cyan('docker compose up -d')}`));
      }
      process.exit(1);
    }
  });

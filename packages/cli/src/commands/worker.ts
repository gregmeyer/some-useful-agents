import { Command } from 'commander';
import { loadConfig } from '../config.js';
import * as ui from '../ui.js';

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

    ui.banner('Starting Temporal worker', [
      `Address:    ${address}`,
      `Namespace:  ${namespace}`,
      `Task queue: ${taskQueue}`,
    ]);

    try {
      const worker = await startWorker({ address, namespace, taskQueue });
      ui.ok('Worker connected. Listening for agent runs...');
      console.log(ui.dim('Press Ctrl+C to stop.\n'));

      process.on('SIGINT', () => {
        console.log('\nShutting down worker...');
        worker.shutdown();
      });

      await worker.run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.fail(`Worker failed: ${msg}`);
      if (msg.includes('ECONNREFUSED') || msg.includes('connection refused')) {
        console.error(ui.dim(`\nIs Temporal running? Start it with: ${ui.cmd('docker compose up -d')}`));
      }
      process.exit(1);
    }
  });

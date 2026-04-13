import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import { createProvider } from '../provider-factory.js';

function collectName(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export const runCommand = new Command('run')
  .description('Run an agent')
  .argument('<name>', 'Agent name')
  .option('--provider <provider>', 'Override provider (local | temporal)')
  .option(
    '--allow-untrusted-shell <name>',
    'Permit a community shell agent to run (repeatable; per-agent, not global)',
    collectName,
    [] as string[],
  )
  .option('--verbose', 'Show detailed output')
  .action(async (name: string, options: { provider?: string; allowUntrustedShell: string[] }) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    // Include community catalog so community agents are runnable; the shell
    // gate in `executeAgent` enforces per-agent opt-in via --allow-untrusted-shell.
    const { agents } = loadAgents({ directories: dirs.all });

    const agent = agents.get(name);
    if (!agent) {
      console.error(chalk.red(`Agent "${name}" not found.`));
      console.error(chalk.dim('Run "sua agent list" to see available agents.'));
      process.exit(1);
    }

    const provider = await createProvider(config, {
      providerOverride: options.provider,
      allowUntrustedShell: new Set(options.allowUntrustedShell),
    });
    const spinner = ora(`Running ${chalk.cyan(name)} via ${chalk.dim(provider.name)}...`).start();

    try {
      let run;
      try {
        run = await provider.submitRun({ agent, triggeredBy: 'cli' });
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }
      spinner.text = `Running ${chalk.cyan(name)} (${chalk.dim(run.id.slice(0, 8))})...`;

      // Poll for completion
      let current = run;
      let pendingWarned = false;
      const startedAt = Date.now();
      while (current.status === 'running' || current.status === 'pending') {
        await new Promise(r => setTimeout(r, 250));
        const updated = await provider.getRun(run.id);
        if (updated) current = updated;

        // Warn if workflow stays pending > 5s (likely no worker running for temporal)
        if (!pendingWarned && provider.name === 'temporal' && current.status === 'pending' && Date.now() - startedAt > 5000) {
          spinner.warn(
            `Run still pending after 5s. Is the worker running? Start it with: ${chalk.cyan('sua worker start')}`
          );
          pendingWarned = true;
          spinner.start();
        }
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

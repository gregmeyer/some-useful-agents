import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { loadAgents, LocalScheduler } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import { createProvider } from '../provider-factory.js';
import * as ui from '../ui.js';

export const scheduleCommand = new Command('schedule')
  .description('Manage scheduled agent runs');

scheduleCommand
  .command('list')
  .description('List agents with a schedule field')
  .action(() => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.all });

    const scheduled = Array.from(agents.values()).filter(a => a.schedule);
    if (scheduled.length === 0) {
      ui.info('No agents have a schedule. Add `schedule: "<cron>"` to an agent YAML.');
      return;
    }

    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Schedule'), chalk.bold('Valid?')],
    });
    for (const agent of scheduled) {
      const valid = LocalScheduler.isValid(agent.schedule!);
      table.push([
        ui.agent(agent.name),
        agent.schedule!,
        valid ? chalk.green('yes') : chalk.red('no'),
      ]);
    }
    ui.section('Scheduled Agents');
    console.log(table.toString());
  });

scheduleCommand
  .command('validate')
  .description('Validate the cron expression of a scheduled agent')
  .argument('<name>', 'Agent name')
  .action((name: string) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.all });
    const agent = agents.get(name);
    if (!agent) {
      ui.fail(`Agent "${name}" not found.`);
      process.exit(1);
    }
    if (!agent.schedule) {
      ui.warn(`Agent "${name}" has no schedule field.`);
      return;
    }
    const valid = LocalScheduler.isValid(agent.schedule);
    if (valid) {
      ui.ok(`"${agent.schedule}" is a valid cron expression.`);
    } else {
      ui.fail(`"${agent.schedule}" is not a valid cron expression.`);
      process.exit(1);
    }
  });

function collectName(value: string, previous: string[]): string[] {
  return [...previous, value];
}

scheduleCommand
  .command('start')
  .description('Start the scheduler daemon (foreground)')
  .option(
    '--allow-untrusted-shell <name>',
    'Permit a community shell agent to fire on schedule (repeatable; per-agent, not global)',
    collectName,
    [] as string[],
  )
  .action(async (options: { allowUntrustedShell: string[] }) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    // Load runnable + catalog so community agents can fire on schedule;
    // the shell gate in executeAgent enforces per-agent opt-in.
    const { agents, warnings } = loadAgents({ directories: dirs.all });

    for (const w of warnings) {
      ui.warn(`${w.file}: ${w.message}`);
    }

    const provider = await createProvider(config, {
      allowUntrustedShell: new Set(options.allowUntrustedShell),
    });

    const scheduler = new LocalScheduler({
      provider,
      agents,
      onFire: (agent, runId) => {
        const ts = new Date().toISOString();
        console.log(`${ui.dim(ts)} ${chalk.green('fired')} ${ui.agent(agent.name)} ${ui.dim(`run=${runId.slice(0, 8)}`)}`);
      },
      onError: (agent, err) => {
        ui.fail(`Error firing ${agent.name}: ${err.message}`);
      },
    });

    let entries;
    try {
      entries = scheduler.start();
    } catch (err) {
      ui.fail((err as Error).message);
      await provider.shutdown();
      process.exit(1);
    }

    if (entries.length === 0) {
      ui.warn('No agents have a schedule. Add `schedule: "<cron>"` to an agent YAML and restart.');
      await provider.shutdown();
      return;
    }

    const bannerLines = entries.map(
      ({ agent, schedule }) => `${agent.name.padEnd(24)} ${schedule}`,
    );
    ui.banner(`Scheduler running (${entries.length} agent${entries.length === 1 ? '' : 's'})`, bannerLines);
    console.log(ui.dim('Press Ctrl+C to stop.\n'));

    const shutdown = async () => {
      console.log('\nShutting down scheduler...');
      scheduler.stop();
      await provider.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  });

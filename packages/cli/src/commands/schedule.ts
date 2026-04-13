import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { loadAgents, LocalScheduler } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import { createProvider } from '../provider-factory.js';

export const scheduleCommand = new Command('schedule')
  .description('Manage scheduled agent runs');

scheduleCommand
  .command('list')
  .description('List agents with a schedule field')
  .action(() => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.runnable });

    const scheduled = Array.from(agents.values()).filter(a => a.schedule);
    if (scheduled.length === 0) {
      console.log(chalk.dim('No agents have a schedule. Add `schedule: "<cron>"` to an agent YAML.'));
      return;
    }

    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Schedule'), chalk.bold('Valid?')],
    });
    for (const agent of scheduled) {
      const valid = LocalScheduler.isValid(agent.schedule!);
      table.push([
        chalk.cyan(agent.name),
        agent.schedule!,
        valid ? chalk.green('yes') : chalk.red('no'),
      ]);
    }
    console.log('\n' + chalk.bold('Scheduled Agents') + '\n');
    console.log(table.toString());
  });

scheduleCommand
  .command('validate')
  .description('Validate the cron expression of a scheduled agent')
  .argument('<name>', 'Agent name')
  .action((name: string) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.runnable });
    const agent = agents.get(name);
    if (!agent) {
      console.error(chalk.red(`Agent "${name}" not found.`));
      process.exit(1);
    }
    if (!agent.schedule) {
      console.log(chalk.yellow(`Agent "${name}" has no schedule field.`));
      return;
    }
    const valid = LocalScheduler.isValid(agent.schedule);
    if (valid) {
      console.log(chalk.green(`"${agent.schedule}" is a valid cron expression.`));
    } else {
      console.error(chalk.red(`"${agent.schedule}" is not a valid cron expression.`));
      process.exit(1);
    }
  });

scheduleCommand
  .command('start')
  .description('Start the scheduler daemon (foreground)')
  .action(async () => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents, warnings } = loadAgents({ directories: dirs.runnable });

    for (const w of warnings) {
      console.error(chalk.yellow(`Warning: ${w.file}: ${w.message}`));
    }

    const provider = await createProvider(config);

    const scheduler = new LocalScheduler({
      provider,
      agents,
      onFire: (agent, runId) => {
        const ts = new Date().toISOString();
        console.log(`${chalk.dim(ts)} ${chalk.green('fired')} ${chalk.cyan(agent.name)} run=${runId.slice(0, 8)}`);
      },
      onError: (agent, err) => {
        console.error(chalk.red(`Error firing ${agent.name}: ${err.message}`));
      },
    });

    let entries;
    try {
      entries = scheduler.start();
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      await provider.shutdown();
      process.exit(1);
    }

    if (entries.length === 0) {
      console.log(chalk.yellow('No agents have a schedule. Add `schedule: "<cron>"` to an agent YAML and restart.'));
      await provider.shutdown();
      return;
    }

    console.log(chalk.bold(`\nScheduler running with ${entries.length} agent(s):`));
    for (const { agent, schedule } of entries) {
      console.log(`  ${chalk.cyan(agent.name)}  ${chalk.dim(schedule)}`);
    }
    console.log(chalk.dim('\nPress Ctrl+C to stop.\n'));

    const shutdown = async () => {
      console.log('\nShutting down scheduler...');
      scheduler.stop();
      await provider.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  });

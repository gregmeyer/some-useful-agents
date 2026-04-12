import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';

export const listCommand = new Command('list')
  .description('List available agents')
  .option('--catalog', 'Show community catalog agents')
  .action((options) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);

    const directories = options.catalog ? dirs.catalog : dirs.runnable;
    const label = options.catalog ? 'Community Catalog' : 'Available Agents';

    const { agents, warnings } = loadAgents({ directories });

    for (const w of warnings) {
      console.error(chalk.yellow(`Warning: ${w.file}: ${w.message}`));
    }

    if (agents.size === 0) {
      console.log(chalk.dim(`No agents found. ${options.catalog ? '' : 'Run "sua init" to get started.'}`));
      return;
    }

    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Type'), chalk.bold('Description')],
    });

    for (const [, agent] of agents) {
      table.push([
        chalk.cyan(agent.name),
        agent.type === 'shell' ? chalk.green('shell') : chalk.magenta('claude-code'),
        agent.description ?? chalk.dim('(no description)'),
      ]);
    }

    console.log(`\n${chalk.bold(label)}\n`);
    console.log(table.toString());
    console.log(chalk.dim(`\n${agents.size} agent(s)`));
  });

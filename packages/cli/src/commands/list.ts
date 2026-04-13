import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';

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
      ui.warn(`${w.file}: ${w.message}`);
    }

    if (agents.size === 0) {
      ui.info(
        options.catalog
          ? 'No catalog agents found.'
          : 'No agents found. Run "sua init" to get started.',
      );
      return;
    }

    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Type'), chalk.bold('Description')],
    });

    for (const [, agent] of agents) {
      table.push([
        ui.agent(agent.name),
        agent.type === 'shell' ? chalk.green('shell') : chalk.magenta('claude-code'),
        agent.description ?? ui.dim('(no description)'),
      ]);
    }

    ui.section(label);
    console.log(table.toString());
    console.log(ui.dim(`\n${agents.size} agent(s)`));
  });

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';
import { listDisabledAgents } from './disable.js';

export const listCommand = new Command('list')
  .description('List available agents')
  .option('--catalog', 'Show community catalog agents')
  .option('--disabled', 'Show agents that have been paused via `sua agent disable`')
  .action((options: { catalog?: boolean; disabled?: boolean }) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);

    if (options.disabled) {
      const paused = listDisabledAgents(dirs.all);
      if (paused.length === 0) {
        ui.info('No disabled agents. Pause one with `sua agent disable <name>`.');
        return;
      }
      const table = new Table({
        head: [chalk.bold('Name'), chalk.bold('Type'), chalk.bold('Source'), chalk.bold('Description')],
      });
      for (const a of paused) {
        table.push([
          ui.agent(a.name),
          a.type === 'shell' ? chalk.green('shell') : a.type === 'claude-code' ? chalk.magenta('claude-code') : ui.dim('?'),
          ui.dim(a.source),
          a.description ?? ui.dim('(no description)'),
        ]);
      }
      ui.section('Disabled Agents');
      console.log(table.toString());
      console.log(ui.dim(`\n${paused.length} paused — re-enable with \`sua agent enable <name>\``));
      return;
    }

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

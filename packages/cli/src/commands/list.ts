import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import { listV2Agents } from '../v2-runtime.js';
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
          a.type === 'shell' ? chalk.green('shell') : (a.type === 'claude-code' || a.type === 'llm-prompt') ? chalk.magenta(a.type) : ui.dim('?'),
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

    // v2 agents live in the run DB, not on disk, and `loadAgents` silently
    // skips every v2 YAML file. Listing only v1 here is what made
    // `sua agent run <v2-id>` unusable: the failure message sent people to
    // this list, and this list could never contain what they wanted.
    // `--catalog` stays v1-only — it reads the community YAML directory,
    // which is a different thing from the imported store. See ADR-0032.
    const v2Agents = options.catalog ? [] : listV2Agents();

    if (agents.size === 0 && v2Agents.length === 0) {
      ui.info(
        options.catalog
          ? 'No catalog agents found.'
          : 'No agents found. Run "sua init" to get started.',
      );
      return;
    }

    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Model'), chalk.bold('Type'), chalk.bold('Description')],
    });

    for (const [, agent] of agents) {
      table.push([
        ui.agent(agent.name),
        ui.dim('v1'),
        agent.type === 'shell' ? chalk.green('shell') : chalk.magenta(agent.type),
        agent.description ?? ui.dim('(no description)'),
      ]);
    }

    for (const agent of v2Agents) {
      // A v2 agent is a DAG, so "type" is its shape rather than one node
      // kind. Show the node count; `sua workflow show <id>` has the detail.
      const nodeCount = `${agent.nodes.length} node${agent.nodes.length === 1 ? '' : 's'}`;
      table.push([
        ui.agent(agent.id),
        chalk.cyan('v2'),
        agent.status === 'active' ? chalk.magenta(nodeCount) : ui.dim(`${nodeCount} · ${agent.status}`),
        agent.description ?? ui.dim('(no description)'),
      ]);
    }

    const total = agents.size + v2Agents.length;
    ui.section(label);
    console.log(table.toString());
    console.log(ui.dim(`\n${total} agent(s)`));
    if (v2Agents.length > 0) {
      console.log(ui.dim(`Run any of them with \`sua agent run <name>\`.`));
    }
  });

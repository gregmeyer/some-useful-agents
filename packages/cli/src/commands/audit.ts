import { Command } from 'commander';
import chalk from 'chalk';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';

/**
 * Read-only inspection of an agent. Prints the full resolved YAML including
 * type, source, command/prompt, schedule, mcp, secrets, and dependsOn so a
 * user can audit a community agent before running `sua agent run --allow-untrusted-shell`.
 */
export const auditCommand = new Command('audit')
  .description('Print the resolved YAML for an agent so you can audit it before running')
  .argument('<name>', 'Agent name')
  .action((name: string) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: [...dirs.runnable, ...dirs.catalog] });

    const agent = agents.get(name);
    if (!agent) {
      console.error(chalk.red(`Agent "${name}" not found.`));
      console.error(chalk.dim('Run "sua agent list" or "sua agent list --catalog" to see options.'));
      process.exit(1);
    }

    const sourceLabel = agent.source ?? 'local';
    const headerColor = sourceLabel === 'community' ? chalk.red.bold : chalk.cyan.bold;
    console.log('');
    console.log(headerColor(`Agent: ${agent.name}  [source=${sourceLabel}]`));
    console.log('');

    // Top-line fields
    row('description', agent.description ?? chalk.dim('(none)'));
    row('type', agent.type);
    row('timeout', String(agent.timeout ?? 300));

    if (agent.type === 'shell') {
      console.log('');
      console.log(chalk.bold('command:'));
      const commandColor = sourceLabel === 'community' ? chalk.red : chalk.white;
      console.log('  ' + commandColor(agent.command ?? ''));
    } else if (agent.type === 'claude-code') {
      console.log('');
      console.log(chalk.bold('prompt:'));
      console.log('  ' + (agent.prompt ?? ''));
      if (agent.model) row('model', agent.model);
      if (agent.maxTurns) row('maxTurns', String(agent.maxTurns));
      if (agent.allowedTools?.length) row('allowedTools', agent.allowedTools.join(', '));
    }

    console.log('');
    row('schedule', agent.schedule ?? chalk.dim('(none)'));
    if (agent.allowHighFrequency) row('allowHighFrequency', chalk.yellow('true'));
    row('mcp', agent.mcp === true ? chalk.green('true (exposed)') : 'false');
    row('redactSecrets', agent.redactSecrets === true ? 'true' : 'false');
    if (agent.workingDirectory) row('workingDirectory', agent.workingDirectory);

    if (agent.secrets?.length) {
      row('secrets', agent.secrets.join(', '));
    }
    if (agent.envAllowlist?.length) {
      row('envAllowlist', agent.envAllowlist.join(', '));
    }
    if (agent.env && Object.keys(agent.env).length > 0) {
      console.log('');
      console.log(chalk.bold('env:'));
      for (const [k, v] of Object.entries(agent.env)) {
        console.log(`  ${chalk.cyan(k)}=${v}`);
      }
    }
    if (agent.dependsOn?.length) row('dependsOn', agent.dependsOn.join(', '));
    if (agent.input) {
      console.log('');
      console.log(chalk.bold('input:'));
      console.log('  ' + agent.input);
    }

    if (sourceLabel === 'community') {
      console.log('');
      console.log(
        chalk.yellow(
          `⚠ This is a community agent. Shell agents from community sources are refused by default; `,
        ),
      );
      console.log(
        chalk.yellow(
          `  opt in with --allow-untrusted-shell ${agent.name} on "sua agent run" / "sua schedule start" `,
        ),
      );
      console.log(
        chalk.yellow(
          `  only after reading the command above and confirming it is safe to execute as your user.`,
        ),
      );
    }
    console.log('');
  });

function row(label: string, value: string): void {
  console.log(`  ${chalk.dim(label.padEnd(18))} ${value}`);
}

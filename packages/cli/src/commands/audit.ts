import { Command } from 'commander';
import chalk from 'chalk';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';

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
      ui.fail(`Agent "${name}" not found.`);
      console.error(ui.dim('Run "sua agent list" or "sua agent list --catalog" to see options.'));
      process.exit(1);
    }

    const sourceLabel = agent.source ?? 'local';
    const headerColor = sourceLabel === 'community' ? chalk.red.bold : chalk.cyan.bold;
    console.log('');
    console.log(headerColor(`Agent: ${agent.name}  [source=${sourceLabel}]`));
    console.log('');

    // Top-line fields
    ui.kv('description', agent.description ?? ui.dim('(none)'));
    ui.kv('type', agent.type);
    ui.kv('timeout', String(agent.timeout ?? 300));

    if (agent.type === 'shell') {
      console.log('');
      console.log(chalk.bold('command:'));
      const commandColor = sourceLabel === 'community' ? chalk.red : chalk.white;
      console.log('  ' + commandColor(agent.command ?? ''));
    } else if (agent.type === 'claude-code') {
      console.log('');
      console.log(chalk.bold('prompt:'));
      console.log('  ' + (agent.prompt ?? ''));
      if (agent.model) ui.kv('model', agent.model);
      if (agent.maxTurns) ui.kv('maxTurns', String(agent.maxTurns));
      if (agent.allowedTools?.length) ui.kv('allowedTools', agent.allowedTools.join(', '));
    }

    console.log('');
    ui.kv('schedule', agent.schedule ?? ui.dim('(none)'));
    if (agent.allowHighFrequency) ui.kv('allowHighFrequency', chalk.yellow('true'));
    ui.kv('mcp', agent.mcp === true ? chalk.green('true (exposed)') : 'false');
    ui.kv('redactSecrets', agent.redactSecrets === true ? 'true' : 'false');
    if (agent.workingDirectory) ui.kv('workingDirectory', agent.workingDirectory);

    if (agent.secrets?.length) {
      ui.kv('secrets', agent.secrets.join(', '));
    }
    if (agent.envAllowlist?.length) {
      ui.kv('envAllowlist', agent.envAllowlist.join(', '));
    }
    if (agent.env && Object.keys(agent.env).length > 0) {
      console.log('');
      console.log(chalk.bold('env:'));
      for (const [k, v] of Object.entries(agent.env)) {
        console.log(`  ${chalk.cyan(k)}=${v}`);
      }
    }
    if (agent.dependsOn?.length) ui.kv('dependsOn', agent.dependsOn.join(', '));
    if (agent.input) {
      console.log('');
      console.log(chalk.bold('input:'));
      console.log('  ' + agent.input);
    }

    if (agent.inputs && Object.keys(agent.inputs).length > 0) {
      console.log('');
      console.log(chalk.bold('inputs:'));
      for (const [name, spec] of Object.entries(agent.inputs)) {
        const parts: string[] = [chalk.cyan(name), ui.dim(`(${spec.type})`)];
        if (spec.type === 'enum' && spec.values?.length) {
          parts.push(ui.dim(`one of: ${spec.values.join(', ')}`));
        }
        if (spec.default !== undefined) {
          parts.push(ui.dim(`default=${JSON.stringify(spec.default)}`));
        } else if (spec.required !== false) {
          parts.push(chalk.yellow('required'));
        } else {
          parts.push(ui.dim('optional'));
        }
        console.log('  ' + parts.join('  '));
        if (spec.description) {
          console.log('    ' + ui.dim(spec.description));
        }
      }
    }

    if (sourceLabel === 'community') {
      console.log('');
      ui.warn(
        `This is a community agent. Shell agents from community sources are refused by default;\n` +
          `  opt in with --allow-untrusted-shell ${agent.name} on "sua agent run" / "sua schedule start"\n` +
          `  only after reading the command above and confirming it is safe to execute as your user.`,
      );
    }
    console.log('');
  });

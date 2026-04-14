import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadAgents } from '@some-useful-agents/core';
import { loadConfig, getAgentDirs } from '../config.js';
import { createProvider } from '../provider-factory.js';
import * as ui from '../ui.js';

function collectName(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectInput(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf('=');
  if (eq <= 0) {
    throw new Error(`--input expects KEY=value (got: "${value}")`);
  }
  const key = value.slice(0, eq);
  const val = value.slice(eq + 1);
  return { ...previous, [key]: val };
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
  .option(
    '--input <KEY=value>',
    'Supply a value for a declared input (repeatable). KEY must be UPPERCASE_WITH_UNDERSCORES.',
    collectInput,
    {} as Record<string, string>,
  )
  .option('--verbose', 'Show detailed output')
  .addHelpText(
    'after',
    `
Inputs:
  Agents can declare typed parameters in their YAML; supply values with
  --input. Example:

    # In agents/local/weather.yaml
    inputs:
      ZIP:   { type: number, required: true }
      STYLE: { type: enum, values: [haiku, verse], default: haiku }

    # Then:
    $ sua agent run weather --input ZIP=94110
    $ sua agent run weather --input ZIP=10001 --input STYLE=verse

  claude-code prompts can reference {{inputs.X}}; shell commands read
  them as $X environment variables. See README "Templates" section.
`,
  )
  .action(async (name: string, options: {
    provider?: string;
    allowUntrustedShell: string[];
    input: Record<string, string>;
  }) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    // Include community catalog so community agents are runnable; the shell
    // gate in `executeAgent` enforces per-agent opt-in via --allow-untrusted-shell.
    const { agents } = loadAgents({ directories: dirs.all });

    const agent = agents.get(name);
    if (!agent) {
      ui.fail(`Agent "${name}" not found.`);
      console.error(ui.dim('Run "sua agent list" to see available agents.'));
      process.exit(1);
    }

    const provider = await createProvider(config, {
      providerOverride: options.provider,
      allowUntrustedShell: new Set(options.allowUntrustedShell),
    });
    const spinner = ora(`Running ${ui.agent(name)} via ${ui.dim(provider.name)}...`).start();

    try {
      let run;
      try {
        run = await provider.submitRun({
          agent,
          triggeredBy: 'cli',
          inputs: options.input,
        });
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }
      spinner.text = `Running ${ui.agent(name)} (${ui.id(run.id.slice(0, 8))})...`;

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
            `Run still pending after 5s. Is the worker running? Start it with: ${ui.cmd('sua worker start')}`
          );
          pendingWarned = true;
          spinner.start();
        }
      }

      if (current.status === 'completed') {
        spinner.succeed(`${ui.agent(name)} completed`);
        if (current.result) {
          console.log('');
          ui.outputFrame(current.result);
        }
      } else {
        spinner.fail(`${ui.agent(name)} ${current.status}`);
        if (current.error) {
          console.error(chalk.red(current.error));
        }
      }

      console.log(ui.dim(`\nRun ID: ${current.id}`));
    } finally {
      await provider.shutdown();
    }
  });

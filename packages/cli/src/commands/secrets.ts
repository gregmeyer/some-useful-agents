import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { createInterface } from 'node:readline';
import { EncryptedFileStore, loadAgents } from '@some-useful-agents/core';
import { loadConfig, getSecretsPath, getAgentDirs } from '../config.js';
import * as ui from '../ui.js';

function getStore() {
  const config = loadConfig();
  return new EncryptedFileStore(getSecretsPath(config));
}

async function promptSecret(name: string): Promise<string> {
  // Support piped input (echo "val" | sua secrets set KEY)
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8').trim();
  }

  // Interactive: read with echo suppression
  process.stdout.write(chalk.dim(`Enter value for ${name} (input hidden): `));

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (m: boolean) => void };
    stdin.setRawMode?.(true);

    let value = '';
    const onData = (chunk: Buffer) => {
      const str = chunk.toString('utf-8');
      for (const ch of str) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(value);
          return;
        } else if (ch === '\x03') { // Ctrl-C
          process.exit(130);
        } else if (ch === '\x7f') { // backspace
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

export const secretsCommand = new Command('secrets')
  .description('Manage secrets used by agents');

secretsCommand
  .command('set')
  .description('Set a secret value')
  .argument('<name>', 'Secret name (e.g. MY_API_KEY)')
  .action(async (name: string) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      ui.fail(`Invalid secret name "${name}". Must be uppercase with underscores (e.g. MY_API_KEY).`);
      process.exit(1);
    }

    const value = await promptSecret(name);
    if (!value) {
      ui.fail('No value provided.');
      process.exit(1);
    }

    const store = getStore();
    await store.set(name, value);
    ui.ok(`Set secret ${ui.agent(name)}`);
  });

secretsCommand
  .command('get')
  .description('Print a secret value')
  .argument('<name>', 'Secret name')
  .action(async (name: string) => {
    const store = getStore();
    const value = await store.get(name);
    if (value === undefined) {
      ui.fail(`Secret "${name}" not set.`);
      process.exit(1);
    }
    console.log(value);
  });

secretsCommand
  .command('list')
  .description('List secret names (values not shown)')
  .action(async () => {
    const store = getStore();
    const names = await store.list();

    if (names.length === 0) {
      ui.info('No secrets set. Run `sua secrets set <NAME>` to add one.');
      return;
    }

    const table = new Table({ head: [chalk.bold('Name')] });
    for (const name of names) {
      table.push([ui.agent(name)]);
    }
    console.log(table.toString());
    console.log(ui.dim(`\n${names.length} secret(s)`));
  });

secretsCommand
  .command('delete')
  .description('Delete a secret')
  .argument('<name>', 'Secret name')
  .action(async (name: string) => {
    const store = getStore();
    if (!(await store.has(name))) {
      ui.warn(`Secret "${name}" not found.`);
      process.exit(1);
    }
    await store.delete(name);
    ui.ok(`Deleted secret ${ui.agent(name)}`);
  });

secretsCommand
  .command('check')
  .description('Show which secrets an agent needs and their status')
  .argument('<agent>', 'Agent name')
  .action(async (agentName: string) => {
    const config = loadConfig();
    const dirs = getAgentDirs(config);
    const { agents } = loadAgents({ directories: dirs.all });

    const agent = agents.get(agentName);
    if (!agent) {
      ui.fail(`Agent "${agentName}" not found.`);
      process.exit(1);
    }

    const declared = agent.secrets ?? [];
    if (declared.length === 0) {
      ui.info(`Agent "${agentName}" declares no secrets.`);
      return;
    }

    const store = getStore();
    const table = new Table({ head: [chalk.bold('Secret'), chalk.bold('Status')] });

    for (const name of declared) {
      const has = await store.has(name);
      table.push([
        ui.agent(name),
        has ? chalk.green('set') : chalk.red('missing'),
      ]);
    }
    console.log(table.toString());
  });

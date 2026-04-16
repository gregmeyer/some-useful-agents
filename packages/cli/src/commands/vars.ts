import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { VariablesStore, looksLikeSensitive } from '@some-useful-agents/core';
import { loadConfig } from '../config.js';
import * as ui from '../ui.js';
import { join } from 'node:path';

function getVarsPath(): string {
  const config = loadConfig();
  return join(config.dataDir, '.sua', 'variables.json');
}

export const varsCommand = new Command('vars')
  .description('Manage global variables (non-sensitive, project-wide values)');

varsCommand
  .command('list')
  .description('List all global variables (names + values)')
  .action(() => {
    const store = new VariablesStore(getVarsPath());
    const vars = store.list();
    const names = Object.keys(vars).sort();

    if (names.length === 0) {
      ui.info('No global variables set. Run `sua vars set <NAME> <VALUE>` to add one.');
      return;
    }

    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Value'), chalk.bold('Description')],
    });

    for (const name of names) {
      const v = vars[name];
      const warn = looksLikeSensitive(name) ? chalk.yellow(' ⚠') : '';
      table.push([
        ui.agent(name) + warn,
        v.value,
        v.description ?? '',
      ]);
    }
    console.log(table.toString());
    console.log(ui.dim(`\n${names.length} variable(s)`));

    const sensitive = names.filter(looksLikeSensitive);
    if (sensitive.length > 0) {
      console.log('');
      ui.warn(
        `${sensitive.length} variable(s) have names that look sensitive: ${sensitive.join(', ')}. ` +
        `If these are secrets, move them to \`sua secrets set\` for encrypted storage.`,
      );
    }
  });

varsCommand
  .command('get')
  .description('Print a variable\'s value')
  .argument('<name>', 'Variable name')
  .action((name: string) => {
    const store = new VariablesStore(getVarsPath());
    const v = store.getValue(name);
    if (v === undefined) {
      ui.fail(`Variable "${name}" not set.`);
      process.exit(1);
    }
    console.log(v);
  });

varsCommand
  .command('set')
  .description('Set a global variable')
  .argument('<name>', 'Variable name (e.g. API_BASE_URL)')
  .argument('<value>', 'Value')
  .option('-d, --description <desc>', 'Optional description')
  .action((name: string, value: string, options: { description?: string }) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      ui.fail(`Invalid variable name "${name}". Must be UPPERCASE_WITH_UNDERSCORES.`);
      process.exit(1);
    }

    if (looksLikeSensitive(name)) {
      ui.warn(
        `"${name}" looks like it might be a secret. If this value is sensitive, ` +
        `use \`sua secrets set ${name}\` instead (encrypted storage).`,
      );
    }

    const store = new VariablesStore(getVarsPath());
    store.set(name, value, options.description);
    ui.ok(`Set ${ui.agent(name)} = ${value}`);
  });

varsCommand
  .command('delete')
  .description('Delete a global variable')
  .argument('<name>', 'Variable name')
  .action((name: string) => {
    const store = new VariablesStore(getVarsPath());
    if (!store.delete(name)) {
      ui.warn(`Variable "${name}" not found.`);
      process.exit(1);
    }
    ui.ok(`Deleted ${ui.agent(name)}`);
  });

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  listBuiltinTools,
  getBuiltinTool,
  toolDefinitionSchema,
  ToolStore,
  type ToolDefinition,
} from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';
import * as ui from '../ui.js';

export const toolCommand = new Command('tool')
  .description('Manage tools used by agent nodes');

toolCommand
  .command('list')
  .description('List all available tools (built-in + user-defined)')
  .action(() => {
    const builtins = listBuiltinTools();
    const config = loadConfig();
    const dbPath = getDbPath(config);

    let userTools: ToolDefinition[] = [];
    try {
      const store = new ToolStore(dbPath);
      userTools = store.listTools();
      store.close();
    } catch {
      // DB may not exist yet — fine, just show builtins.
    }

    if (builtins.length === 0 && userTools.length === 0) {
      ui.info('No tools available.');
      return;
    }

    const table = new Table({
      head: [
        chalk.bold('Id'),
        chalk.bold('Source'),
        chalk.bold('Impl'),
        chalk.bold('Description'),
      ],
    });

    for (const t of builtins) {
      table.push([
        ui.agent(t.id),
        chalk.dim('builtin'),
        chalk.dim(t.implementation.type),
        t.description ?? '',
      ]);
    }

    for (const t of userTools) {
      table.push([
        ui.agent(t.id),
        t.source,
        t.implementation.type,
        t.description ?? '',
      ]);
    }

    console.log(table.toString());
    console.log(ui.dim(`\n${builtins.length} built-in, ${userTools.length} user-defined`));
  });

toolCommand
  .command('show')
  .description('Show a tool\'s definition (inputs, outputs, implementation)')
  .argument('<id>', 'Tool id')
  .action((id: string) => {
    // Check builtins first.
    const builtin = getBuiltinTool(id);
    if (builtin) {
      printToolDetail(builtin.definition);
      return;
    }

    // Check user store.
    const config = loadConfig();
    const dbPath = getDbPath(config);
    try {
      const store = new ToolStore(dbPath);
      const tool = store.getTool(id);
      store.close();
      if (tool) {
        printToolDetail(tool);
        return;
      }
    } catch {
      // DB not available.
    }

    ui.fail(`Tool "${id}" not found.`);
    process.exit(1);
  });

toolCommand
  .command('validate')
  .description('Schema-check a tool YAML file without storing it')
  .argument('<file>', 'Path to a tool YAML file')
  .action((file: string) => {
    if (!existsSync(file) || statSync(file).isDirectory()) {
      ui.fail(`Not a file: ${file}`);
      process.exit(1);
    }

    let raw: unknown;
    try {
      const text = readFileSync(file, 'utf-8');
      raw = parseYaml(text);
    } catch (err) {
      ui.fail(`Cannot parse ${file}: ${(err as Error).message}`);
      process.exit(1);
    }

    const result = toolDefinitionSchema.safeParse(raw);
    if (result.success) {
      ui.ok(`${file} is valid.`);
      ui.kv('Id', result.data.id);
      ui.kv('Name', result.data.name);
      ui.kv('Inputs', Object.keys(result.data.inputs).join(', ') || 'none');
      ui.kv('Outputs', Object.keys(result.data.outputs).join(', ') || 'none');
      ui.kv('Implementation', result.data.implementation.type);
    } else {
      ui.fail(`${file} has validation errors:`);
      for (const issue of result.error.issues) {
        console.log(`  ${chalk.red('✖')} ${issue.path.join('.')}: ${issue.message}`);
      }
      process.exit(1);
    }
  });

function printToolDetail(tool: ToolDefinition): void {
  ui.section(tool.name);
  ui.kv('Id', tool.id);
  ui.kv('Source', tool.source);
  ui.kv('Description', tool.description ?? ui.dim('none'));
  ui.kv('Implementation', tool.implementation.type);

  if (Object.keys(tool.inputs).length > 0) {
    console.log('');
    ui.section('Inputs');
    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Type'), chalk.bold('Required'), chalk.bold('Default'), chalk.bold('Description')],
    });
    for (const [name, spec] of Object.entries(tool.inputs)) {
      table.push([
        chalk.cyan(name),
        spec.type,
        spec.required ? 'yes' : chalk.dim('no'),
        spec.default !== undefined ? String(spec.default) : chalk.dim('—'),
        spec.description ?? '',
      ]);
    }
    console.log(table.toString());
  }

  if (Object.keys(tool.outputs).length > 0) {
    console.log('');
    ui.section('Outputs');
    const table = new Table({
      head: [chalk.bold('Name'), chalk.bold('Type'), chalk.bold('Description')],
    });
    for (const [name, spec] of Object.entries(tool.outputs)) {
      table.push([chalk.cyan(name), spec.type, spec.description ?? '']);
    }
    console.log(table.toString());
  }
}

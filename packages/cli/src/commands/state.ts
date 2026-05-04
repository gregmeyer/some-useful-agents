/**
 * `sua state` — manage per-agent state directories.
 *
 * Subcommands:
 *   list                 every agent with a state dir, sorted by size
 *   du <agent>           breakdown per file inside one agent's state dir
 *   prune <agent>        clear contents (or --remove the dir entirely)
 *   export <agent> [path] tar.gz the dir to a path or stdout
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  existsSync,
  readdirSync,
  statSync,
  rmSync,
  createWriteStream,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  stateDirFor,
  stateDirSize,
  formatBytes,
} from '@some-useful-agents/core';
import { loadConfig, getDataRoot } from '../config.js';
import * as ui from '../ui.js';

const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;

export const stateCommand = new Command('state').description(
  'Manage per-agent state directories (data/agent-state/<id>/)',
);

// ── list ─────────────────────────────────────────────────────────────────

stateCommand
  .command('list')
  .description('List every agent that has a state directory, with sizes.')
  .action(() => {
    const config = loadConfig();
    const dataRoot = getDataRoot(config);
    const stateRoot = join(dataRoot, 'agent-state');
    if (!existsSync(stateRoot)) {
      console.log(chalk.dim('No agent state directories yet.'));
      return;
    }
    const entries = readdirSync(stateRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const id = String(e.name);
        return { id, bytes: stateDirSize(id, dataRoot) };
      })
      .sort((a, b) => b.bytes - a.bytes);

    if (entries.length === 0) {
      console.log(chalk.dim('No agent state directories yet.'));
      return;
    }

    const table = new Table({ head: [chalk.bold('Agent'), chalk.bold('Size')] });
    let total = 0;
    for (const row of entries) {
      table.push([row.id, formatBytes(row.bytes)]);
      total += row.bytes;
    }
    table.push([chalk.bold('Total'), chalk.bold(formatBytes(total))]);
    console.log(table.toString());
  });

// ── du ───────────────────────────────────────────────────────────────────

stateCommand
  .command('du <agent>')
  .description("Show what's in one agent's state directory, with sizes.")
  .action((agent: string) => {
    if (!SAFE_AGENT_ID.test(agent)) {
      ui.fail(`Invalid agent id: ${agent}`);
      process.exit(1);
    }
    const config = loadConfig();
    const dir = stateDirFor(agent, getDataRoot(config));
    if (!existsSync(dir)) {
      console.log(chalk.dim(`No state directory for "${agent}".`));
      return;
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.length === 0) {
      console.log(chalk.dim(`State dir for "${agent}" is empty (${dir}).`));
      return;
    }
    const table = new Table({ head: [chalk.bold('Entry'), chalk.bold('Size')] });
    let total = 0;
    for (const entry of entries) {
      const name = String(entry.name);
      const full = join(dir, name);
      let bytes = 0;
      if (entry.isDirectory()) {
        bytes = walkSize(full);
        table.push([`${name}/`, formatBytes(bytes)]);
      } else if (entry.isFile()) {
        try { bytes = statSync(full).size; } catch { /* skip */ }
        table.push([name, formatBytes(bytes)]);
      }
      total += bytes;
    }
    table.push([chalk.bold('Total'), chalk.bold(formatBytes(total))]);
    console.log(table.toString());
    console.log(chalk.dim(`(${dir})`));
  });

function walkSize(path: string): number {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try { entries = readdirSync(path, { withFileTypes: true }) as import('node:fs').Dirent[]; } catch { return 0; }
  for (const entry of entries) {
    const full = join(path, String(entry.name));
    try {
      if (entry.isDirectory()) total += walkSize(full);
      else if (entry.isFile()) total += statSync(full).size;
    } catch { /* race */ }
  }
  return total;
}

// ── prune ────────────────────────────────────────────────────────────────

stateCommand
  .command('prune <agent>')
  .description('Clear contents of an agent state directory (keeps the empty dir).')
  .option('--remove', 'Delete the directory entirely (default: clear contents only).')
  .option('-y, --yes', 'Skip the confirmation prompt.')
  .action(async (agent: string, opts: { remove?: boolean; yes?: boolean }) => {
    if (!SAFE_AGENT_ID.test(agent)) {
      ui.fail(`Invalid agent id: ${agent}`);
      process.exit(1);
    }
    const config = loadConfig();
    const dir = stateDirFor(agent, getDataRoot(config));
    if (!existsSync(dir)) {
      console.log(chalk.dim(`No state directory for "${agent}".`));
      return;
    }
    const before = stateDirSize(agent, getDataRoot(config));
    if (!opts.yes) {
      const action = opts.remove ? 'delete' : 'clear';
      const ok = await confirm(`${action} state for "${agent}" (${formatBytes(before)})? [y/N] `);
      if (!ok) {
        console.log(chalk.dim('Cancelled.'));
        return;
      }
    }
    if (opts.remove) {
      rmSync(dir, { recursive: true, force: true });
      ui.ok(`Removed ${dir} (freed ${formatBytes(before)}).`);
    } else {
      // Clear contents but keep the dir.
      for (const entry of readdirSync(dir)) {
        rmSync(join(dir, entry), { recursive: true, force: true });
      }
      ui.ok(`Cleared ${dir} (freed ${formatBytes(before)}).`);
    }
  });

// ── export ───────────────────────────────────────────────────────────────

stateCommand
  .command('export <agent> [path]')
  .description('Tar+gzip an agent state directory to a path (or stdout when omitted).')
  .action((agent: string, path?: string) => {
    if (!SAFE_AGENT_ID.test(agent)) {
      ui.fail(`Invalid agent id: ${agent}`);
      process.exit(1);
    }
    const config = loadConfig();
    const dataRoot = getDataRoot(config);
    const dir = stateDirFor(agent, dataRoot);
    if (!existsSync(dir)) {
      ui.fail(`No state directory for "${agent}".`);
      process.exit(1);
    }
    // Use system tar for portability — bundling tar.js would be heavy for
    // this rarely-used verb. -C dataRoot/agent-state so the archive root is
    // <agent-id>/ rather than the full absolute path.
    const tarArgs = ['-czf', path ?? '-', '-C', join(dataRoot, 'agent-state'), agent];
    if (path) {
      const result = spawnSync('tar', tarArgs, { stdio: 'inherit' });
      if (result.status !== 0) {
        ui.fail(`tar exited with code ${result.status ?? 'unknown'}.`);
        process.exit(1);
      }
      const outBytes = statSync(resolve(path)).size;
      ui.ok(`Exported "${agent}" state → ${path} (${formatBytes(outBytes)}).`);
    } else {
      const result = spawnSync('tar', tarArgs, { stdio: ['inherit', 'inherit', 'inherit'] });
      if (result.status !== 0) {
        process.exit(1);
      }
    }
  });

// ── confirm helper ───────────────────────────────────────────────────────

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((res) => rl.question(prompt, (a) => { rl.close(); res(a); }));
  return /^y(es)?$/i.test(answer.trim());
}

// suppress unused import warning when path isn't used outside one branch
void createWriteStream;

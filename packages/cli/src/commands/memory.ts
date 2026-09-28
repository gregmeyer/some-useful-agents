import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryStore, type Memory } from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';
import * as ui from '../ui.js';

/**
 * `sua memory` — see and prune what an agent remembers (agents with
 * `memory:` on save notes across runs; see docs/memory.md).
 */
export const memoryCommand = new Command('memory')
  .description("See and manage what an agent remembers between runs");

function withStore<T>(fn: (store: MemoryStore) => T): T {
  const store = new MemoryStore(getDbPath(loadConfig()));
  try { return fn(store); } finally { store.close(); }
}

function printMemories(memories: Memory[]): void {
  if (memories.length === 0) {
    console.log(ui.dim('  No memories.'));
    return;
  }
  for (const m of memories) {
    const pin = m.pinned ? chalk.yellow(' pinned') : '';
    const tags = m.tags.length ? ui.dim(` [${m.tags.join(', ')}]`) : '';
    console.log(`  ${chalk.bold(m.id)}${pin}  ${m.text}${tags}`);
    console.log(ui.dim(`      ${m.updatedAt}${m.sourceRunId ? `  run ${m.sourceRunId.slice(0, 8)}` : ''}`));
  }
}

memoryCommand
  .command('list')
  .description("List an agent's memories, pinned first, newest first")
  .argument('<agent>', 'Agent id')
  .option('-n, --limit <n>', 'How many to show', '50')
  .action((agent: string, opts: { limit: string }) => {
    withStore((store) => {
      ui.section(`Memory — ${agent}`);
      printMemories(store.list(agent, Math.max(1, parseInt(opts.limit, 10) || 50)));
    });
  });

memoryCommand
  .command('search')
  .description("Find an agent's memories relevant to a query")
  .argument('<agent>', 'Agent id')
  .argument('<query...>', 'What to look for')
  .action((agent: string, query: string[]) => {
    withStore((store) => {
      ui.section(`Memory — ${agent} — "${query.join(' ')}"`);
      printMemories(store.search(agent, query.join(' '), 20));
    });
  });

memoryCommand
  .command('forget')
  .description('Delete one memory, or all of an agent\'s memories with --all')
  .argument('<agent>', 'Agent id')
  .argument('[id]', 'Memory id')
  .option('--all', "Forget everything this agent remembers")
  .action((agent: string, id: string | undefined, opts: { all?: boolean }) => {
    withStore((store) => {
      if (opts.all) {
        ui.ok(`Forgot ${store.forgetAll(agent)} memories for ${agent}.`);
        return;
      }
      if (!id) {
        ui.fail('Give a memory id, or --all.');
        process.exitCode = 2;
        return;
      }
      if (store.forget(agent, id)) ui.ok(`Forgot ${id}.`);
      else { ui.fail(`No memory ${id} for ${agent}.`); process.exitCode = 1; }
    });
  });

memoryCommand
  .command('pin')
  .description('Pin a memory (always recalled at the start of a run), or unpin with --off')
  .argument('<agent>', 'Agent id')
  .argument('<id>', 'Memory id')
  .option('--off', 'Unpin instead')
  .action((agent: string, id: string, opts: { off?: boolean }) => {
    withStore((store) => {
      if (store.setPinned(agent, id, !opts.off)) ui.ok(`${opts.off ? 'Unpinned' : 'Pinned'} ${id}.`);
      else { ui.fail(`No memory ${id} for ${agent}.`); process.exitCode = 1; }
    });
  });

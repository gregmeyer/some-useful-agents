/**
 * `sua notebook export|import`: copy a notebook to sua on another machine as
 * a notebook file (.suanb). See docs/notebooks.md "Send a copy to another
 * machine" and core notebook-bundle.ts.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline/promises';
import {
  AgentStore,
  NotebookStore,
  ToolStore,
  exportNotebookBundle,
  packNotebookBundle,
  unpackNotebookBundle,
  checkNotebookBundle,
  importNotebookBundle,
  NotebookFileError,
  type BundleStores,
  type NotebookImportPlan,
} from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';
import * as ui from '../ui.js';

function openStores(): { stores: BundleStores; close: () => void } {
  const dbPath = getDbPath(loadConfig());
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const tools = new ToolStore(dbPath);
  const stores: BundleStores = { notebooks: NotebookStore.fromHandle(db), agents: AgentStore.fromHandle(db), tools };
  return { stores, close: () => { try { tools.close(); } catch { /* ignore */ } try { db.close(); } catch { /* ignore */ } } };
}

const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'notebook'}.suanb`;

/** What importing will do, in lines. */
export function describePlan(plan: NotebookImportPlan, secretNames: readonly string[]): string[] {
  const lines = [
    `"${plan.title}" from ${plan.from.machine} (saved ${plan.from.exportedAt.slice(0, 10)}): ${plan.counts.options} options, ${plan.counts.notes} notes, ${plan.counts.pictures} pictures.`,
    plan.renamed ? `Its id is taken here, so the copy is ${plan.notebookId}; its links point to the copy.` : `It comes in as ${plan.notebookId}.`,
  ];
  const by = (action: string) => plan.agents.filter((a) => a.action === action).map((a) => a.id);
  if (by('install').length) lines.push(`Adds the agents ${by('install').join(', ')}.`);
  const toolsIn = plan.tools.filter((t) => t.action === 'install').map((t) => t.id);
  if (toolsIn.length) lines.push(`Adds the tools ${toolsIn.join(', ')}.`);
  if (by('same').length) lines.push(`Uses ${by('same').join(', ')}, already here as in the copy.`);
  if (by('yours-differs').length) lines.push(`Keeps your own ${by('yours-differs').join(', ')} here, which differ from the copy's.`);
  if (by('missing-example').length) lines.push(`Uses ${by('missing-example').join(', ')}, not installed here (install from the examples).`);
  if (secretNames.length) lines.push(`Its agents need these secrets; check they're set here (sua secrets list): ${secretNames.join(', ')}.`);
  if (plan.scheduleWas) lines.push(`Its schedule (${plan.scheduleWas}) is off here, so two machines don't both fill it.`);
  return lines;
}

export const notebookCommand = new Command('notebook')
  .description('Copy notebooks between sua installs as notebook files (.suanb)');

notebookCommand
  .command('export')
  .description('Save a notebook as a notebook file, to import into sua on another machine')
  .argument('<id>', 'The notebook id (from its URL: /notebooks/<id>)')
  .argument('[file]', 'Where to save it (default: its title, .suanb, here)')
  .action((id: string, file: string | undefined) => {
    const { stores, close } = openStores();
    try {
      const bundle = exportNotebookBundle(stores, id);
      if (!bundle) { ui.fail(`There's no notebook "${id}".`); process.exit(1); }
      const out = file ?? fileName(bundle.meta.title);
      const bytes = packNotebookBundle(bundle);
      writeFileSync(out, bytes);
      ui.ok(`Saved "${bundle.meta.title}" to ${out} (${(bytes.length / 1e6).toFixed(1)} MB).`);
      console.log(ui.dim(`  With ${bundle.agents.length} of your agents, ${bundle.tools.length} tools${bundle.secrets.length ? `, and the names of ${bundle.secrets.length} secrets (not their values)` : ''}. On the other machine: sua notebook import ${out}`));
    } finally {
      close();
    }
  });

notebookCommand
  .command('import')
  .description('Import a notebook file saved by sua on another machine')
  .argument('<file>', 'The .suanb file')
  .option('-y, --yes', 'Import without asking')
  .action(async (file: string, opts: { yes?: boolean }) => {
    if (!existsSync(file)) { ui.fail(`Not a file: ${file}`); process.exit(1); }
    let bundle;
    try {
      bundle = unpackNotebookBundle(readFileSync(file));
    } catch (err) {
      ui.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    const { stores, close } = openStores();
    try {
      const plan = checkNotebookBundle(stores, bundle);
      for (const line of describePlan(plan, bundle.secrets)) console.log(`  ${line}`);
      if (plan.problems.length) {
        ui.fail("It can't be imported:");
        for (const p of plan.problems) console.log(`  ${chalk.red('✖')} ${p}`);
        process.exit(1);
      }
      if (!opts.yes) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('Import it? [y/N] ')).trim().toLowerCase();
        rl.close();
        if (answer !== 'y' && answer !== 'yes') { console.log('Nothing imported.'); return; }
      }
      const r = importNotebookBundle(stores, bundle);
      ui.ok(`Imported "${plan.title}" as ${r.notebookId}. Open it at /notebooks/${r.notebookId}.`);
    } catch (err) {
      if (err instanceof NotebookFileError) { ui.fail(err.message); process.exit(1); }
      throw err;
    } finally {
      close();
    }
  });

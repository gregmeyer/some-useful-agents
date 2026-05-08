/**
 * `sua agent reimport <path>` — refresh an agent (or directory of agents)
 * in the run DB from its on-disk YAML.
 *
 * Why this exists: editing `agents/examples/*.yaml` doesn't propagate to
 * the AgentStore — once an agent is imported, the DB is the source of
 * truth. Without this verb, every YAML edit needs a one-off node-script
 * upsert. The wizard already auto-upserts the build-planner on each
 * /agents/build call (see run-now-build.ts); this is the same mechanic
 * exposed as a discoverable CLI verb.
 *
 * Behaviour:
 *  - Single file: parse + upsert that one agent.
 *  - Directory:   walk every *.yaml, parse each, upsert each.
 *
 * Idempotent: when the YAML matches the current DB version, AgentStore's
 * upsertAgent only refreshes metadata and skips a new version row.
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Command } from 'commander';
import { AgentStore, parseAgent } from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';
import * as ui from '../ui.js';

interface ReimportResult {
  file: string;
  status: 'created' | 'updated' | 'unchanged' | 'failed';
  message?: string;
}

export const reimportCommand = new Command('reimport')
  .description('Re-import a v2 agent YAML (or directory of them) into the run DB')
  .argument('<path>', 'Path to a YAML file or a directory containing YAMLs')
  .action((targetArg: string) => {
    const target = resolve(targetArg);
    if (!existsSync(target)) {
      ui.fail(`Path not found: ${target}`);
      process.exit(1);
    }

    const files = collectYamlFiles(target);
    if (files.length === 0) {
      ui.warn(`No .yaml/.yml files found at ${target}`);
      process.exit(1);
    }

    // Open the run DB. Mirrors the workflow.ts openStores helper — share
    // a single DatabaseSync handle across stores so we don't fight over
    // write locks within this one process.
    const config = loadConfig();
    const dbPath = getDbPath(config);
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    const store = AgentStore.fromHandle(db);

    const results: ReimportResult[] = [];
    try {
      for (const file of files) {
        results.push(reimportOne(store, file));
      }
    } finally {
      db.close();
    }

    renderResults(results);
    process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
  });

function collectYamlFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return [];
  return readdirSync(target)
    .filter((f) => {
      const ext = extname(f).toLowerCase();
      return ext === '.yaml' || ext === '.yml';
    })
    .map((f) => join(target, f));
}

function reimportOne(store: AgentStore, file: string): ReimportResult {
  let yaml: string;
  try { yaml = readFileSync(file, 'utf-8'); }
  catch (e) { return { file, status: 'failed', message: (e as Error).message }; }

  let agent;
  try { agent = parseAgent(yaml); }
  catch (e) {
    // v1 YAML files (no v2 id+nodes shape) parseAgent rejects with
    // "Validation failed:" — flag them clearly rather than crashing.
    return { file, status: 'failed', message: (e as Error).message };
  }

  const before = store.getAgent(agent.id);
  let after;
  try { after = store.upsertAgent(agent, 'cli', `Reimport from ${file}`); }
  catch (e) { return { file, status: 'failed', message: (e as Error).message }; }

  if (!before) return { file, status: 'created', message: `${agent.id} v${after.version}` };
  if (after.version === before.version) {
    // upsertAgent leaves the version unchanged when the DAG is identical
    // (only metadata refreshed). Surface that distinctly so the user
    // knows nothing semantically changed.
    return { file, status: 'unchanged', message: `${agent.id} (DAG identical, metadata refreshed)` };
  }
  return { file, status: 'updated', message: `${agent.id} v${before.version} → v${after.version}` };
}

function renderResults(results: ReimportResult[]): void {
  const counts = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  for (const r of results) {
    counts[r.status] += 1;
    const line = `${r.file}: ${r.message ?? ''}`;
    if (r.status === 'failed') ui.fail(line);
    else if (r.status === 'created' || r.status === 'updated') ui.ok(line);
    else ui.info(line);
  }
  console.log('');
  const total = results.length;
  const summary = `${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged${counts.failed ? `, ${counts.failed} failed` : ''} (${total} file${total === 1 ? '' : 's'})`;
  if (counts.failed > 0) ui.fail(summary);
  else ui.ok(summary);
}

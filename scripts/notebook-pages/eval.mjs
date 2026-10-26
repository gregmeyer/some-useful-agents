#!/usr/bin/env node
/**
 * Does the real page agent still pick the right page for each kind of
 * notebook? Runs `notebook-page` (agents/examples/notebook-page.yaml) on
 * every example notebook (packages/dashboard/src/lib/notebook-page-examples.ts)
 * a few times and scores it:
 *
 *   right page   the shortlist for a choice, the Meeting briefing for meeting
 *                prep, a page of its own for a question or a plan
 *   first try    it drew a usable page that reads well without a second try
 *   usable       a page came back at all (after the one retry)
 *   has parts    the parts the job needs are on it (a briefing's cover, facts, agenda, quotes)
 *   same answer  every run gave the same kind of page
 *
 * It calls the model (a few dozen calls), so it runs on demand: before
 * merging a change to the page agent, the drawing guide or the ready-made
 * pages. Uses this machine's LLM CLI, in a scratch store (never your data).
 *
 *   npm run build && node scripts/notebook-pages/eval.mjs [--runs 2] [--only car,trip]
 *     [--record]          save run 1's replies as the recorded answers the tests use
 *     [--write-baseline]  save this scorecard as the baseline to compare with
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = await import(join(ROOT, 'packages/core/dist/index.js'));
const { drawNotebookPage } = await import(join(ROOT, 'packages/dashboard/dist/lib/notebook-page.js'));
const { NOTEBOOK_PAGE_EXAMPLES } = await import(join(ROOT, 'packages/dashboard/dist/lib/notebook-page-examples.js'));
const { notebookWidgetComponents } = await import(join(ROOT, 'packages/dashboard/dist/lib/notebook-widgets.js'));

const ANSWERS = join(ROOT, 'packages/dashboard/src/lib/fixtures/notebook-pages/answers.json');
const BASELINE = join(ROOT, 'scripts/notebook-pages/baseline.json');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(`--${name}`);
const runs = Math.max(1, Number(arg('runs', '2')) || 2);
const only = arg('only')?.split(',');
const examples = NOTEBOOK_PAGE_EXAMPLES.filter((e) => !only || only.includes(e.id));

const agent = core.parseAgent(readFileSync(join(ROOT, 'agents/examples/notebook-page.yaml'), 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'sua-page-eval-'));
const runStore = new core.RunStore(join(dir, 'runs.db'));
const store = core.NotebookStore.fromHandle(runStore.databaseHandle());

async function ask(inputs) {
  const runId = randomUUID();
  await core.executeAgentDag(agent, { triggeredBy: 'cli', runId, inputs }, { runStore, dataRoot: dir });
  const run = runStore.getRun(runId);
  return run?.status === 'completed' ? run.result ?? undefined : undefined;
}

const kindOf = (answer) => ('error' in answer ? 'none' : 'keep' in answer ? 'shortlist' : answer.layout.preset === 'dossier' ? 'dossier' : answer.layout.preset ? `preset:${answer.layout.preset}` : 'drawn');

const rows = [];
const recorded = existsSync(ANSWERS) ? JSON.parse(readFileSync(ANSWERS, 'utf8')) : {};
for (const ex of examples) {
  const tries = [];
  for (let r = 0; r < runs; r++) {
    const id = ex.seed(store, { data: true });
    const replies = [];
    const started = Date.now();
    const drawn = await drawNotebookPage(store.get(id), async (inputs) => { const reply = await ask(inputs); replies.push(reply ?? ''); return reply; });
    const kind = kindOf(drawn.answer);
    let parts = true;
    let rhythm = [];
    if ('layout' in drawn.answer) {
      const page = notebookWidgetComponents({ ...store.get(id), layout: drawn.answer.layout });
      const names = new Set(page.map((c) => c.component));
      parts = (ex.expect.needs ?? []).every((n) => names.has(n));
      if (!drawn.answer.layout.preset) rhythm = core.pageRhythm(drawn.answer.layout.components);
    }
    tries.push({ kind, right: kind === ex.expect.page, first: drawn.tries === 1, usable: kind !== 'none', parts, rhythm, notes: drawn.firstNotes, seconds: Math.round((Date.now() - started) / 1000), about: 'layout' in drawn.answer ? drawn.answer.layout.about : drawn.answer.about });
    if (r === 0 && flag('record') && kind !== 'none') recorded[ex.id] = { replies };
    process.stderr.write(`${ex.id} run ${r + 1}: ${kind}${drawn.tries > 1 ? ' (2 tries)' : ''}\n`);
  }
  const rate = (k) => tries.filter((t) => t[k]).length / tries.length;
  rows.push({ id: ex.id, job: ex.job, expect: ex.expect.page, got: tries.map((t) => t.kind), right: rate('right'), first: rate('first'), usable: rate('usable'), parts: rate('parts'), same: new Set(tries.map((t) => t.kind)).size === 1 ? 1 : 0, tries });
}

const mean = (k) => rows.reduce((n, r) => n + r[k], 0) / Math.max(1, rows.length);
const METRICS = ['right', 'first', 'usable', 'parts', 'same'];
const totals = Object.fromEntries(METRICS.map((k) => [k, Math.round(mean(k) * 100) / 100]));
const pct = (x) => `${Math.round(x * 100)}%`;

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined;
console.log(`\nNotebook pages: ${rows.length} examples × ${runs} runs\n`);
console.log('| notebook | wants | got | right | first try | has parts |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.id} (${r.job}) | ${r.expect} | ${r.got.join(', ')} | ${pct(r.right)} | ${pct(r.first)} | ${pct(r.parts)} |`);
console.log(`\n| overall | ${METRICS.join(' | ')} |\n|---|${METRICS.map(() => '---').join('|')}|`);
console.log(`| now | ${METRICS.map((k) => pct(totals[k])).join(' | ')} |`);
let worse = [];
if (base) {
  console.log(`| baseline (${base.at.slice(0, 10)}) | ${METRICS.map((k) => pct(base.totals[k] ?? 0)).join(' | ')} |`);
  // A drop of more than one run in five is worth a look before merging.
  worse = METRICS.filter((k) => (base.totals[k] ?? 0) - totals[k] > 0.2);
  for (const r of rows) {
    const was = base.rows.find((b) => b.id === r.id);
    if (was && was.right === 1 && r.right < 1) worse.push(`${r.id} now gets ${r.got.join(', ')}`);
  }
}
for (const r of rows) for (const t of r.tries) if (t.notes) console.log(`\n${r.id}: needed a second try: ${t.notes.slice(0, 300)}`);

const out = arg('out', join(tmpdir(), 'sua-notebook-pages-scorecard.json'));
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), runs, totals, rows }, null, 2));
console.log(`\nScorecard: ${out}`);
if (flag('write-baseline')) { writeFileSync(BASELINE, `${JSON.stringify({ at: new Date().toISOString(), runs, totals, rows: rows.map(({ tries, ...r }) => r) }, null, 2)}\n`); console.log(`Baseline saved: ${BASELINE}`); }
if (flag('record')) { writeFileSync(ANSWERS, `${JSON.stringify(recorded, null, 2)}\n`); console.log(`Recorded answers saved: ${ANSWERS} (run the tests: the outlines may change)`); }
runStore.close();
if (!flag('keep')) rmSync(dir, { recursive: true, force: true });
if (worse.length) { console.log(`\nWorse than the baseline: ${worse.join('; ')}`); process.exitCode = 1; }

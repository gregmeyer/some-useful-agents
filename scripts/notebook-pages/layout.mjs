#!/usr/bin/env node
/**
 * Does each kind of notebook's page look right in a browser? Opens every
 * example notebook (packages/dashboard/src/lib/notebook-page-examples.ts),
 * on the page its recorded answer gives it, at desktop width in light and
 * dark and at phone width, and measures what the checks in the tests can't:
 *
 *   hole       a part beside a taller one leaves open space under it
 *   empty frame  a framed part stretched to a taller neighbour's height, blank inside
 *   too long   one part runs longer than about a screen and a half
 *   sideways   the page scrolls sideways
 *
 * It flags rather than compares pixels, and saves a screenshot of each so
 * they can be looked at together. A scratch dashboard on its own data (no
 * model is ever called: photos, facets and setup answer nothing).
 *
 *   npm run build && node scripts/notebook-pages/layout.mjs [--only car,trip] [--out dir] [--port 3109] [--chrome path]
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = await import(join(ROOT, 'packages/core/dist/index.js'));
const dash = await import(join(ROOT, 'packages/dashboard/dist/index.js'));
const { MemorySecretsSession } = await import(join(ROOT, 'packages/dashboard/dist/secrets-session.js'));
const { drawNotebookPage } = await import(join(ROOT, 'packages/dashboard/dist/lib/notebook-page.js'));
const { NOTEBOOK_PAGE_EXAMPLES } = await import(join(ROOT, 'packages/dashboard/dist/lib/notebook-page-examples.js'));
const { chromium } = await import('playwright');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : process.argv[i + 1]; };
const only = arg('only')?.split(',');
const PORT = Number(arg('port', '3109'));
const out = arg('out', join(tmpdir(), 'sua-notebook-pages'));
mkdirSync(out, { recursive: true });
const ANSWERS = JSON.parse(readFileSync(join(ROOT, 'packages/dashboard/src/lib/fixtures/notebook-pages/answers.json'), 'utf8'));

// A scratch dashboard: its own database, every model hook answering nothing.
const dir = mkdtempSync(join(tmpdir(), 'sua-page-layout-'));
const dbPath = join(dir, 'runs.db');
const secretsStore = new core.MemorySecretsStore();
const runStore = new core.RunStore(dbPath);
const provider = new core.LocalProvider(dbPath, secretsStore);
await provider.initialize();
const store = core.NotebookStore.fromHandle(runStore.databaseHandle());
const TOKEN = 't'.repeat(64);
const none = async () => undefined;
const ctx = {
  token: TOKEN, allowlist: core.buildLoopbackAllowlist(PORT), port: PORT, provider, runStore,
  agentStore: new core.AgentStore(dbPath), loadAgents: () => core.loadAgents({ directories: [] }),
  secretsStore, secretsSession: new MemorySecretsSession({ backing: secretsStore }),
  tokenPath: join(dir, 'mcp-token'), retentionDays: 30, dbPath, secretsPath: join(dir, 'secrets.enc'), rotateToken: () => TOKEN,
  packsStore: new core.PacksStore(dbPath), dashboardsStore: new core.DashboardsStore(dbPath), allowUntrustedShell: new Set(),
  activeRuns: new Map(), inboxTriageAbortControllers: new Map(), inboxTriagePendingRefires: new Set(), dataDir: dir,
  dashboardBaseUrl: `http://127.0.0.1:${PORT}`, inboxStore: core.InboxStore.fromHandle(runStore.databaseHandle()),
  notebookPictureRun: none, notebookFacetsRun: none, notebookPageRun: none, notebookCheckerRun: none, notebookFinderRun: none,
  notebookResearchRun: none, notebookDrafterRun: none, notebookSuggesterRun: none, notebookKeeperRun: none,
  notebookPersonPhotoCheck: async () => ({ why: 'not in a layout check' }),
};

const examples = NOTEBOOK_PAGE_EXAMPLES.filter((e) => !only || only.includes(e.id));
const ids = {};
for (const ex of examples) {
  const id = ex.seed(store, { data: true });
  store.markSetup?.(id);
  const replies = ANSWERS[ex.id]?.replies ?? [];
  let n = 0;
  const drawn = await drawNotebookPage(store.get(id), async () => replies[Math.min(n++, replies.length - 1)]);
  if ('layout' in drawn.answer) store.setLayout(id, drawn.answer.layout, 'notebook');
  ids[ex.id] = id;
}

const server = dash._buildDashboardApp(ctx).listen(PORT, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${PORT}`;

/** Measured in the page: holes beside taller parts, parts that run long, sideways scroll. */
function measure() {
  const deep = (root, sel, acc = []) => {
    root.querySelectorAll(sel).forEach((e) => acc.push(e));
    root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) deep(e.shadowRoot, sel, acc); });
    return acc;
  };
  const self = (el, sel) => [...(el.matches?.(sel) ? [el] : []), ...deep(el, sel)];
  const title = (panel) => panel.shadowRoot?.querySelector('h3')?.textContent?.trim() || panel.tagName.toLowerCase();
  // Where a cell's content ends: under its last panel's last part, else the cell itself.
  const contentBottom = (cell) => {
    const panels = self(cell, 'sua-a2ui-panel');
    if (!panels.length) return cell.getBoundingClientRect().bottom;
    return Math.max(...panels.map((p) => { const sec = p.shadowRoot?.querySelector('section'); const last = sec?.lastElementChild; return (last ?? p).getBoundingClientRect().bottom; }));
  };
  const issues = [];
  for (const cols of deep(document, 'sua-a2ui-columns')) {
    const grid = cols.shadowRoot?.querySelector('.cols');
    const cells = grid ? [...grid.children] : [];
    if (cells.length < 2 || getComputedStyle(grid).gridTemplateColumns.split(' ').length < 2) continue;
    const top = grid.getBoundingClientRect().top;
    const ends = cells.map(contentBottom);
    const tallest = Math.max(...ends);
    const height = tallest - top;
    cells.forEach((cell, i) => {
      const gap = tallest - ends[i];
      if (gap <= Math.max(160, height * 0.35)) return;
      // A frame stretched to its row's height is a box with blank space in it; an unframed part leaves open page.
      const panel = self(cell, 'sua-a2ui-panel')[0];
      const framed = !!panel?.shadowRoot?.querySelector('section.frame:not(.lede):not(.feature):not(.aside):not(.band)');
      issues.push({ kind: framed ? 'empty frame' : 'hole', part: panel ? title(panel) : cell.tagName.toLowerCase(), px: Math.round(gap) });
    });
  }
  for (const p of deep(document, 'sua-a2ui-panel')) {
    const h = p.getBoundingClientRect().height;
    // The shortlist's grid is the page: it runs as long as the options do.
    if (deep(p.shadowRoot ?? p, 'sua-a2ui-option-grid').length) continue;
    if (h > innerHeight * 1.5) issues.push({ kind: 'too long', part: title(p), px: Math.round(h) });
  }
  const wide = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (wide > 1) issues.push({ kind: 'sideways', part: 'page', px: wide });
  return issues;
}

const VIEWS = [
  { name: 'wide-light', width: 1280, height: 900, scheme: 'light' },
  { name: 'wide-dark', width: 1280, height: 900, scheme: 'dark' },
  { name: 'phone', width: 420, height: 860, scheme: 'light' },
];
// Playwright's own browser, or any Chrome (--chrome <path>, e.g. one an older Playwright installed).
const browser = await chromium.launch(arg('chrome') ? { executablePath: arg('chrome') } : {});
const results = [];
try {
  for (const view of VIEWS) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, colorScheme: view.scheme });
    // The dashboard is dark unless you chose light (its own setting, not the system's).
    await context.addInitScript((scheme) => { try { localStorage.setItem('sua-theme', scheme); } catch { /* none */ } }, view.scheme);
    const page = await context.newPage();
    await page.goto(`${base}/auth#token=${TOKEN}`);
    await page.waitForLoadState('networkidle');
    for (const ex of examples) {
      await page.goto(`${base}/notebooks/${ids[ex.id]}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const issues = await page.evaluate(measure);
      const shot = join(out, `${ex.id}-${view.name}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      results.push({ example: ex.id, view: view.name, issues, shot });
      process.stderr.write(`${ex.id} ${view.name}: ${issues.length ? issues.map((i) => `${i.kind} (${i.part}, ${i.px}px)`).join('; ') : 'ok'}\n`);
    }
  }
} finally {
  await browser.close();
  server.close();
  runStore.close();
  rmSync(dir, { recursive: true, force: true });
}

// A contact sheet of every page, to look at together.
const sheet = `<!doctype html><meta charset="utf-8"><title>Notebook pages</title><style>body{font:14px system-ui;margin:16px;background:#faf9f7}h2{font-size:15px;margin:24px 0 8px}.row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}figure{margin:0;max-width:420px}img{width:100%;border:1px solid #ddd}figcaption{font-size:12px;color:#666}.bad{color:#b45309}</style>
${examples.map((ex) => `<h2>${ex.id} — ${ex.job}</h2><div class="row">${results.filter((r) => r.example === ex.id).map((r) => `<figure><img src="${r.shot.split('/').pop()}"><figcaption class="${r.issues.length ? 'bad' : ''}">${r.view}: ${r.issues.length ? r.issues.map((i) => `${i.kind} (${i.part}, ${i.px}px)`).join('; ') : 'ok'}</figcaption></figure>`).join('')}</div>`).join('\n')}`;
writeFileSync(join(out, 'index.html'), sheet);
const flagged = results.filter((r) => r.issues.length);
console.log(`\n${results.length} pages, ${flagged.length} flagged. Screenshots: ${join(out, 'index.html')}`);
for (const r of flagged) console.log(`  ${r.example} ${r.view}: ${r.issues.map((i) => `${i.kind} (${i.part}, ${i.px}px)`).join('; ')}`);
// Blank space inside the shortlist's equal-height frames is how it's always looked: reported, not a failure.
if (flagged.some((r) => r.issues.some((i) => i.kind !== 'empty frame'))) process.exitCode = 1;

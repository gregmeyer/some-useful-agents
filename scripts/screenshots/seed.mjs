#!/usr/bin/env node
/**
 * Screenshot fixtures: a fresh sua project full of made-up, anonymized data,
 * for the README and docs screenshots. Nothing here comes from a real
 * install: no names, no real listings, no machine or git details.
 *
 *   npm run build
 *   node scripts/screenshots/seed.mjs /tmp/sua-screens
 *   cd /tmp/sua-screens && node <repo>/packages/cli/dist/index.js dashboard start --port 3099 --provider local
 *
 * Then sign in at http://127.0.0.1:3099/auth and take the shots listed in
 * scripts/screenshots/README.md. Re-running on the same folder starts over.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(repo, 'packages', 'cli', 'dist', 'index.js');
const core = await import(join(repo, 'packages', 'core', 'dist', 'index.js'));
const { RunStore, AgentStore, NotebookStore, InboxStore, BoardsStore } = core;

const dir = resolve(process.argv[2] ?? '/tmp/sua-screens');
if (!existsSync(cli)) { console.error('Build first: npm run build'); process.exit(1); }
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const sua = (...args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
  if (r.status !== 0) console.warn(`sua ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout).slice(-300)}`);
  return r;
};

console.log(`Seeding ${dir}`);
sua('init');
sua('examples', 'install');

// Real runs of example agents that work offline and print nothing personal.
for (const id of ['hello', 'daily-greeting', 'weather-stub', 'two-step-digest', 'conditional-router', 'research-digest', 'daily-summary', 'parameterised-greet']) {
  sua('agent', 'run', id);
}

const dbPath = join(dir, 'data', 'runs.db');
const runs = new RunStore(dbPath);
const agents = new AgentStore(dbPath);
const db = runs.databaseHandle();
const notebooks = NotebookStore.fromHandle(db);
const inbox = InboxStore.fromHandle(db);
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

// Examples that need an integration or a model stay unscheduled (they'd fail here).
for (const id of ['churn-watcher', 'starter-watch']) { try { agents.updateAgentMeta(id, { schedule: '' }); } catch { /* not installed */ } }
// A few on a schedule, for /scheduled and Pulse.
for (const [id, schedule] of [['weather-stub', '0 7 * * *'], ['daily-summary', '0 18 * * *'], ['two-step-digest', '0 9 * * 1'], ['hello', '*/30 * * * *']]) {
  try { agents.updateAgentMeta(id, { schedule }); } catch { /* not installed */ }
}

// One agent that keeps failing (made-up runs), so Today has something to fix.
for (const [i, min] of [[1, 15], [2, 75], [3, 135]].entries()) {
  runs.createRun({
    id: `00000000-0000-4000-8000-00000000000${String(i + 1)}`, agentName: 'weather-forecast', status: 'failed',
    startedAt: ago(min[1]), completedAt: ago(min[1] - 1), triggeredBy: 'schedule',
    error: 'Node "fetch-forecast" exited with code 6: could not resolve host api.example-weather.test',
  });
}

// Pulse: six offline agents placed in two rows.
const tiles = ['weather-stub', 'daily-summary', 'daily-greeting', 'two-step-digest', 'hello', 'parameterised-greet'];
new BoardsStore(db).saveDoc({ id: 'pulse', name: 'Pulse', expectedVersion: 0, doc: { components: [
  ...tiles.map((agentId, i) => ({ id: `t${String(i + 1)}`, component: 'AgentTile', agentId })),
  { id: 'row1', component: 'Columns', children: ['t1', 't2', 't3'] },
  { id: 'row2', component: 'Columns', children: ['t4', 't5', 't6'] },
  { id: 'root', component: 'Column', children: ['row1', 'row2'] },
] } });

// ── Notebooks ──
const illustrate = (nbId, entryId) => notebooks.savePhoto(nbId, entryId, 'illustration',
  { contentType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') }, { kind: 'illustration' });

function notebook(spec) {
  const nb = notebooks.create({ title: spec.title, statement: spec.statement, params: spec.params, criteria: spec.criteria });
  notebooks.setFields(nb.id, spec.fields);
  notebooks.setStages(nb.id, spec.stages);
  notebooks.setChecks(nb.id, spec.checks);
  notebooks.markSetup(nb.id);
  spec.met?.forEach((i) => notebooks.markCriterion(nb.id, i, true));
  const ids = {};
  for (const o of spec.options) {
    const { entry } = notebooks.upsertOption(nb.id, { title: o.title, body: o.body, data: o.data, by: `agent:${spec.agent}`, runId: spec.runId });
    ids[o.key] = entry.id;
    illustrate(nb.id, entry.id);
    if (o.stage) notebooks.moveOption(nb.id, entry.id, o.stage);
    if (o.out) notebooks.ruleOut(nb.id, entry.id, o.out, 'you', { gone: !!o.gone });
    for (const c of o.checked ?? []) notebooks.checkOption(nb.id, entry.id, c, true);
  }
  for (const n of spec.notes ?? []) notebooks.addEntry(nb.id, { kind: n.kind ?? 'note', title: n.title, body: n.body, by: n.by ?? 'sua' });
  for (const s of spec.searches ?? []) notebooks.recordSearch(nb.id, spec.agent, s.runId, s.found, ago(s.ago), s.sources);
  // Its conversation, with sua waiting on an answer.
  const t = inbox.add({ priority: 'medium', source: 'manual', title: `Notebook: ${spec.title}`, body: '(empty)',
    contextJson: JSON.stringify({ page: { kind: 'notebook', id: nb.id, path: `/notebooks/${nb.id}`, title: spec.title } }) });
  inbox.addResponse(t.id, 'user', spec.said);
  inbox.addResponse(t.id, 'triage', spec.ask);
  inbox.updateStatus(t.id, 'awaiting_user');
  notebooks.setConversation(nb.id, t.id);
  return { nb, ids };
}

notebook({
  title: 'Buy a used hatchback for commuting',
  statement: 'A reliable used hatchback for a 30-mile commute, under $12k, decided by the end of the month.',
  params: ['under $12,000', 'under 90k miles', 'hatchback', 'automatic', 'within 50 miles'],
  criteria: ['At least one car that fits', 'Clean title on the top pick', 'A decision recorded'],
  met: [0],
  agent: 'car-search', runId: '10000000-0000-4000-8000-000000000001',
  fields: [
    { key: 'price', label: 'Price', type: 'money', role: 'price' },
    { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure', better: 'lower' },
    { key: 'year', label: 'Year', type: 'number' },
    { key: 'location', label: 'Location', type: 'text', role: 'place' },
    { key: 'seller', label: 'Seller', type: 'text', role: 'org' },
    { key: 'listing_url', label: 'Listing', type: 'url', role: 'link' },
  ],
  stages: ['Found', 'Checked', 'Test drive', 'Offer', 'Bought'],
  checks: ['Still listed', 'Clean title (VIN)', 'Accident history', 'Pre-purchase inspection'],
  options: [
    { key: 'a', title: '2018 Honda Fit EX, 68,200 mi, $11,450, Riverton', data: { price: 11450, miles: 68200, year: 2018, location: 'Riverton', seller: 'Maple Auto', listing_url: 'https://cars.example.com/l/1001' }, stage: 'Test drive', checked: ['Still listed', 'Clean title (VIN)'] },
    { key: 'b', title: '2017 Mazda3 Touring hatchback, 74,900 mi, $10,900, Lakeside', data: { price: 10900, miles: 74900, year: 2017, location: 'Lakeside', seller: 'private seller', listing_url: 'https://cars.example.com/l/1002' }, stage: 'Checked', checked: ['Still listed'] },
    { key: 'c', title: '2016 Toyota Corolla iM, 81,300 mi, $9,800, Fairview', data: { price: 9800, miles: 81300, year: 2016, location: 'Fairview', seller: 'Cedar Motors', listing_url: 'https://cars.example.com/l/1003' } },
    { key: 'd', title: '2019 Kia Rio 5-door, 52,100 mi, $11,900, Oakdale', data: { price: 11900, miles: 52100, year: 2019, location: 'Oakdale', seller: 'Oakdale Kia', listing_url: 'https://cars.example.com/l/1004' } },
    { key: 'e', title: '2015 Volkswagen Golf TSI, 96,400 mi, $8,700, Hillcrest', data: { price: 8700, miles: 96400, year: 2015, location: 'Hillcrest', seller: 'private seller', listing_url: 'https://cars.example.com/l/1005' }, out: 'Over the mileage limit' },
    { key: 'f', title: '2017 Ford Focus SE hatchback, 63,000 mi, $8,200, Brookside', data: { price: 8200, miles: 63000, year: 2017, location: 'Brookside', seller: 'Brookside Auto', listing_url: 'https://cars.example.com/l/1006' }, out: 'Sold before we called', gone: true },
  ],
  notes: [
    { title: 'Searched three listing sites; one blocked page reads', body: 'Two sites returned listings; the third asked for a sign-in, so it was skipped.' },
    { kind: 'evidence', title: 'Honda Fit: one owner, clean history report', by: 'you' },
  ],
  searches: [
    { runId: '10000000-0000-4000-8000-000000000001', found: 6, ago: 300, sources: [{ name: 'cars.example.com', found: 4, status: 'found' }, { name: 'autos.example.net', found: 2, status: 'found' }, { name: 'listings.example.org', found: 0, status: 'blocked', note: 'asked for a sign-in' }] },
    { runId: '10000000-0000-4000-8000-000000000002', found: 2, ago: 60, sources: [{ name: 'cars.example.com', found: 2, status: 'found' }] },
  ],
  said: 'Help me find a reliable used hatchback for my commute, under $12k.',
  ask: 'The 2016 Corolla iM is the cheapest at $9,800, and the 2018 Honda Fit is furthest along: clean title, test drive next. Want me to book the Fit for Saturday, or check the Corolla first?',
});

notebook({
  title: 'Find a remote product design job',
  statement: 'A remote senior product design role paying $150k or more, at a team that ships.',
  params: ['remote (US)', '$150k+', 'senior or staff', 'product design'],
  criteria: ['Three roles worth applying to', 'An interview scheduled', 'A decision recorded'],
  met: [0, 1],
  agent: 'job-search', runId: '20000000-0000-4000-8000-000000000001',
  fields: [
    { key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher', range: true },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'company', label: 'Company', type: 'text', role: 'org' },
    { key: 'remote', label: 'Remote', type: 'text' },
    { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' },
  ],
  stages: ['Found', 'Applied', 'Screen', 'Interview', 'Offer'],
  checks: ['Salary confirmed', 'Remote policy', 'Talked to the team'],
  options: [
    { key: 'a', title: 'Senior Product Designer, Northwind Labs', data: { salary: { min: 165000, max: 190000 }, title: 'Senior Product Designer', company: 'Northwind Labs', remote: 'Remote (US)', posting_url: 'https://jobs.example.com/p/2001' }, stage: 'Interview' },
    { key: 'b', title: 'Staff Product Designer, Bluefin Health', data: { salary: { min: 180000, max: 210000 }, title: 'Staff Product Designer', company: 'Bluefin Health', remote: 'Remote', posting_url: 'https://jobs.example.com/p/2002' }, stage: 'Applied' },
    { key: 'c', title: 'Product Designer II, Quarry Analytics', data: { salary: { min: 140000, max: 155000 }, title: 'Product Designer II', company: 'Quarry Analytics', remote: 'Hybrid', posting_url: 'https://jobs.example.com/p/2003' }, out: 'Hybrid, not remote' },
    { key: 'd', title: 'Senior Designer, Platform, Lumen & Co', data: { salary: { min: 155000, max: 175000 }, title: 'Senior Designer, Platform', company: 'Lumen & Co', remote: 'Remote (US)', posting_url: 'https://jobs.example.com/p/2004' } },
  ],
  searches: [{ runId: '20000000-0000-4000-8000-000000000001', found: 4, ago: 1440 }],
  said: 'Find me remote senior product design roles paying $150k or more.',
  ask: 'Northwind Labs moved you to a second interview on Thursday. Want a one-page brief on their product and team before then?',
});

notebook({
  title: 'Pick noise-cancelling headphones',
  statement: 'Over-ear noise-cancelling headphones for flights, under $300, comfortable with glasses.',
  params: ['under $300', 'over-ear', 'comfortable with glasses'],
  criteria: ['A pair that fits', 'Tried on in a store', 'A decision recorded'],
  agent: 'product-search', runId: '30000000-0000-4000-8000-000000000001',
  fields: [
    { key: 'price', label: 'Price', type: 'money', role: 'price' },
    { key: 'rating', label: 'Rating', type: 'number', role: 'measure', better: 'higher' },
    { key: 'store', label: 'Store', type: 'text', role: 'org' },
    { key: 'product_url', label: 'Product', type: 'url', role: 'link' },
  ],
  stages: ['Found', 'Shortlist', 'Tried on', 'Bought'],
  checks: ['In stock', 'Return policy'],
  options: [
    { key: 'a', title: 'Aurora ANC 700', data: { price: 279, rating: 4.6, store: 'Sound Shop', product_url: 'https://shop.example.com/a700' }, stage: 'Shortlist' },
    { key: 'b', title: 'Quietline Over-Ear 2', data: { price: 249, rating: 4.4, store: 'Gadget Hub', product_url: 'https://shop.example.com/q2' } },
    { key: 'c', title: 'Halo Travel Pro', data: { price: 199, rating: 4.1, store: 'Sound Shop', product_url: 'https://shop.example.com/htp' } },
  ],
  said: 'Over-ear noise-cancelling headphones for flights, under $300.',
  ask: 'Sound Shop on Main Street has the Aurora ANC 700 in stock to try on. Want me to check their hours?',
});

// Earlier conversations (finished), which New notebook suggests from.
for (const [title, said] of [
  ['Weekend trip ideas', 'Can you help me plan a weekend trip to the coast in November, somewhere quiet with good hiking?'],
  ['Standing desk', 'What is a good standing desk under $500 for a small apartment?'],
  ['Tell me a joke', 'Tell me a joke I have not heard before.'],
]) {
  const t = inbox.add({ priority: 'medium', source: 'manual', title, body: '(empty)' });
  inbox.addResponse(t.id, 'user', said);
  inbox.addResponse(t.id, 'triage', 'Here is what I found.');
  inbox.updateStatus(t.id, 'resolved');
}

// New notebook's pills, ready (normally the notebook-suggester agent writes these).
const suaDir = join(dir, 'data', '.sua');
mkdirSync(join(suaDir, 'brands'), { recursive: true });
writeFileSync(join(suaDir, 'notebook-suggestions.json'), JSON.stringify({ at: Date.now(), items: [
  { label: 'Coast weekend trip', text: 'Plan a quiet weekend trip to the coast in November with good hiking nearby.', from: 'Weekend trip ideas' },
  { label: 'Standing desk', text: 'A good standing desk under $500 that fits a small apartment.', from: 'Standing desk' },
] }, null, 2));

// Two saved brands for Settings → Appearance.
writeFileSync(join(suaDir, 'brands', 'harbor.json'), JSON.stringify({ version: 1, name: 'Harbor', preset: 'default',
  dark: { bg: '#0f1726', surface: '#16213a', text: '#e8edf6', 'text-muted': '#9aa8c2', primary: '#ff7a66' },
  light: { bg: '#f6f7fb', surface: '#ffffff', text: '#14213d', 'text-muted': '#5b6782', primary: '#e0533d' }, radius: { md: 14 } }, null, 2));
writeFileSync(join(suaDir, 'brands', 'paper.json'), JSON.stringify({ version: 1, name: 'Paper', preset: 'editorial' }, null, 2));

runs.close();
agents.close();
console.log('Done. Start it with:');
console.log(`  cd ${dir} && node ${cli} dashboard start --port 3099 --provider local`);

/**
 * The software-scorer example agent's first and last steps are code: prep
 * works out which options still lack which scores, and finish keeps a score
 * only when its quote is word for word on the page it cites, so a score
 * nobody can show stays unknown (never 0). Runs both on a fixture page
 * served locally (no model, no outside network).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { withShellHelpers } from './node-spawner.js';
import { parseAgent } from './agent-yaml.js';

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'software-scorer.yaml'), 'utf8');
const hasPython = spawnSync('python3', ['--version']).status === 0;

let server: Server | undefined;
afterAll(() => { server?.close(); });

async function site(pages: Record<string, string>): Promise<string> {
  server = createServer((req, res) => {
    const body = pages[req.url ?? ''];
    res.statusCode = body === undefined ? 404 : 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body ?? 'not here');
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

function shellNode(id: string, env: Record<string, string>): Promise<string> {
  const node = parseAgent(yaml).nodes.find((n) => n.id === id) as { command: string };
  return new Promise((resolve, reject) => {
    const p = spawn('bash', ['-c', node.command], { env: withShellHelpers({ ...process.env, ...env } as Record<string, string>) });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.stderr.on('data', (d) => { err += String(d); });
    p.on('close', (code) => { if (code !== 0) reject(new Error(err)); else resolve(out); });
  });
}

const anchors = ['none', 'major gaps', 'partial', 'meets it', 'exceeds it'];
const FIELDS = JSON.stringify([
  { key: 'vendor', label: 'Vendor', type: 'text', role: 'org' },
  { key: 'job_fit', label: 'Job fit', type: 'number', weight: 60, anchors, axis: 'suitability' },
  { key: 'cost', label: 'Cost', type: 'number', weight: 40, anchors, axis: 'feasibility' },
]);
const OPTIONS = JSON.stringify([
  { id: 'a', name: 'Acme CRM', facts: { Vendor: 'Acme' }, sources: ['https://acme.example'] },
  { id: 'b', name: 'Bolt CRM', facts: { 'Job fit': 3, Cost: 2 }, sources: [] },
  { id: 'c', name: 'Cobalt CRM', facts: { 'Job fit': 2 }, sources: [] },
]);

describe('software-scorer wiring', () => {
  it('researches through research-fanout, scores with no tools, and files from code', () => {
    const agent = parseAgent(yaml);
    expect(agent.skills).toEqual(['software-rubric']);
    expect(agent.nodes.find((n) => n.id === 'web')).toMatchObject({ type: 'agent-invoke', optional: true, agentInvokeConfig: { agentId: 'research-fanout' } });
    expect(agent.nodes.find((n) => n.id === 'score')).toMatchObject({ type: 'llm-prompt', maxTurns: 1 });
    expect(agent.nodes.filter((n) => n.type === 'llm-prompt' && n.tools?.length)).toEqual([]);
    expect(agent.nodes.at(-1)).toMatchObject({ id: 'finish', type: 'shell' });
  });
});

describe.skipIf(!hasPython)('software-scorer code steps', () => {
  it('prep asks only for the scores each option lacks, with what 0–4 mean', async () => {
    const out = JSON.parse((await shellNode('prep', { FIELDS, OPTIONS })).trim()) as { ok: boolean; todo: Array<{ id: string; missing: string[] }>; ask_json: string; items_json: string };
    expect(out.ok).toBe(true);
    expect(out.todo).toEqual([{ id: 'a', name: 'Acme CRM', missing: ['job_fit', 'cost'], sources: ['https://acme.example'] }, { id: 'c', name: 'Cobalt CRM', missing: ['cost'], sources: [] }]);
    expect(JSON.parse(out.ask_json)[0]).toMatchObject({ key: 'job_fit', label: 'Job fit', hint: expect.stringContaining('0: none; 1: major gaps') });
    expect(JSON.parse(out.items_json)[0]).toEqual({ subject: 'Acme CRM', hint: 'its own site: https://acme.example' });
    const none = JSON.parse((await shellNode('prep', { FIELDS: '[]', OPTIONS })).trim()) as { ok: boolean; why: string };
    expect(none).toMatchObject({ ok: false, why: 'it has no weighted criteria to score' });
  });

  it("keeps a score only when its quote is on its page; 0 is a score, the rest stay unknown", async () => {
    const base = await site({ '/pricing': '<html><p>The Starter plan costs <b>$12 per user</b> per month, billed yearly.</p></html>', '/features': '<p>No pipeline view on any plan.</p>' });
    const prep = await shellNode('prep', { FIELDS, OPTIONS });
    const scores = [
      // On the page, across tags.
      { option: 'a', key: 'cost', score: 4, source: `${base}/pricing`, quote: 'The Starter plan costs $12 per user per month', confidence: 'high' },
      // A real 0, backed by the page.
      { option: 'a', key: 'job_fit', score: 0, source: `${base}/features`, quote: 'No pipeline view on any plan', confidence: 'medium' },
      // Words not on the page: dropped.
      { option: 'c', key: 'cost', score: 3, source: `${base}/pricing`, quote: 'Free for teams of up to ten people', confidence: 'high' },
      // Already has it, or not a criterion, or out of range: ignored.
      { option: 'b', key: 'cost', score: 1, source: `${base}/pricing`, quote: 'The Starter plan costs $12 per user per month' },
      { option: 'a', key: 'vendor', score: 2, source: `${base}/pricing`, quote: 'The Starter plan costs $12 per user per month' },
      { option: 'c', key: 'cost', score: 7, source: `${base}/pricing`, quote: 'The Starter plan costs $12 per user per month' },
    ];
    const out = await shellNode('finish', { UPSTREAM_PREP_RESULT: prep, UPSTREAM_SCORE_RESULT: `Scored.\n<scores>${JSON.stringify(scores)}</scores>` });
    const block = JSON.parse(/<notebook>([\s\S]*)<\/notebook>/.exec(out)![1]) as { facts: Array<{ id: string; data: Record<string, { value: number; checked: boolean; confidence: string }> }>; summary: string };
    expect(block.facts).toEqual([{ id: 'a', data: {
      cost: { value: 4, source: `${base}/pricing`, quote: 'The Starter plan costs $12 per user per month', checked: true, confidence: 'high' },
      job_fit: { value: 0, source: `${base}/features`, quote: 'No pipeline view on any plan', checked: true, confidence: 'medium' },
    } }]);
    expect(block.summary).toBe("Scored 2 criteria across 1 option, each quote found on its page; left unknown: 1 whose words weren't on the page cited.");
  });

  it('a page it cannot read leaves the score unknown, and says so', async () => {
    const base = await site({});
    const prep = await shellNode('prep', { FIELDS, OPTIONS });
    const out = await shellNode('finish', { UPSTREAM_PREP_RESULT: prep, UPSTREAM_SCORE_RESULT: `<scores>${JSON.stringify([{ option: 'a', key: 'cost', score: 3, source: `${base}/gone`, quote: 'The Starter plan costs $12 per user' }])}</scores>` });
    const block = JSON.parse(/<notebook>([\s\S]*)<\/notebook>/.exec(out)![1]) as { facts: unknown[]; entries: Array<{ title: string }> };
    expect(block.facts).toEqual([]);
    expect(block.entries[0].title).toContain("1 whose page couldn't be read");
  });
});

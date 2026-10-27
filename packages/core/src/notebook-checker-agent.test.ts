/**
 * The notebook-checker example agent's last step is code, not a model: it
 * ticks a check only when the judge's quote is word for word in the page it
 * cites (or in the option's own notes), and rules an option out only on a
 * confirmed "not met". This runs that step on a fixture page served locally
 * (no model, no outside network).
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

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'notebook-checker.yaml'), 'utf8');
const hasPython = spawnSync('python3', ['--version']).status === 0;

let server: Server | undefined;
afterAll(() => { server?.close(); });

async function page(body: string): Promise<string> {
  server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(body); });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/case-study`;
}

/** verify, then finish (what's kept), with the second look's reply when given (`look`). */
async function verify(verdicts: unknown[], options: unknown[], checks: string[], extra: Record<string, string> = {}, look = ''): Promise<{ facts: Array<{ id: string; checked?: string[]; ruleOut?: string }>; entries?: Array<{ kind: string; title: string; body: string }>; summary: string; verified: Record<string, unknown> }> {
  const verified = await shellNode('verify', { UPSTREAM_JUDGE_RESULT: `<verdicts>${JSON.stringify(verdicts)}</verdicts>`, OPTIONS: JSON.stringify(options), CHECKS: JSON.stringify(checks), ...extra });
  const out = await shellNode('finish', { UPSTREAM_VERIFY_RESULT: verified, UPSTREAM_LOOK_RESULT: look });
  return { ...JSON.parse(/<notebook>([\s\S]*)<\/notebook>/.exec(out)![1]) as never, verified: JSON.parse(verified.trim().split('\n').at(-1)!) as Record<string, unknown> };
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

describe('notebook-checker wiring', () => {
  it('judges from own facts with no tools, and sends only what is open to research-fanout', () => {
    const agent = parseAgent(yaml);
    expect(agent.nodes.map((n) => n.id)).toEqual(['judge', 'pending', 'web', 'verify', 'look', 'finish']);
    // The second look takes screenshots, only when verify has quotes it couldn't find; finish runs either way.
    expect(agent.nodes.find((n) => n.id === 'look')).toMatchObject({ tools: ['web-screenshot'], onlyIf: { upstream: 'verify', field: 'any_second_look', equals: true } });
    expect(agent.nodes.find((n) => n.id === 'finish')).toMatchObject({ onlyIf: { upstream: 'verify', field: 'ok', equals: true } });
    expect(agent.nodes.find((n) => n.id === 'judge')).toMatchObject({ type: 'llm-prompt', maxTurns: 1 });
    // Research goes through research-fanout; the only model step with a tool is the second look's screenshots.
    expect(agent.nodes.filter((n) => n.type === 'llm-prompt' && n.tools?.length).map((n) => n.id)).toEqual(['look']);
    expect(agent.nodes.find((n) => n.id === 'web')).toMatchObject({ type: 'agent-invoke', optional: true, onlyIf: { upstream: 'pending', field: 'need_web', equals: true }, agentInvokeConfig: { agentId: 'research-fanout' } });
    expect(agent.nodes.find((n) => n.id === 'verify')).toMatchObject({ onlyIf: { upstream: 'pending', field: 'ok', equals: true } });
  });
});

describe.skipIf(!hasPython)('notebook-checker verify step', () => {
  it('ticks only quotes it finds word for word, rules out only a confirmed fail, and leaves the rest open', async () => {
    const url = await page('<html><script>var x = "Customers buy it to close the books faster";</script><p>Customers say they <b>buy it to close the books</b> in half the time.</p></html>');
    const options = [
      { id: 'a', name: 'Acme', facts: { Employees: 300 }, text: 'Acme sells planning software to enterprise finance teams.' },
      { id: 'b', name: 'Bolt', facts: {}, text: 'Bolt makes hand tools for hobbyists and home workshops.' },
      { id: 'c', name: 'Cobalt', facts: {}, text: '' },
    ];
    const checks = ['Sells enterprise software', 'Why people buy is quoted'];
    const out = await verify([
      // From the option's own notes.
      { id: 'a', check: 'sells enterprise software', verdict: 'met', quote: 'sells planning software to enterprise finance teams', url: 'notebook' },
      // From the page, across tags and with odd spacing.
      { id: 'a', check: 'Why people buy is quoted', verdict: 'met', quote: 'Customers say they buy it to close   the books', url },
      // A confirmed fail: ruled out with the quote.
      { id: 'b', check: 'Sells enterprise software', verdict: 'not met', quote: 'hand tools for hobbyists', url: 'notebook' },
      // Words that aren't on the page (only in a script): left open.
      { id: 'c', check: 'Why people buy is quoted', verdict: 'met', quote: 'Customers buy it to close the books faster', url },
      // Unknown, an option or check it wasn't given, a quote too short: nothing.
      { id: 'c', check: 'Sells enterprise software', verdict: 'unknown' },
      { id: 'zz', check: 'Sells enterprise software', verdict: 'met', quote: 'anything at all, long enough', url: 'notebook' },
      { id: 'a', check: 'Has a mascot', verdict: 'met', quote: 'sells planning software to enterprise', url: 'notebook' },
      { id: 'b', check: 'Why people buy is quoted', verdict: 'met', quote: 'hobbyists', url: 'notebook' },
    ], options, checks);
    expect(out.facts.find((f) => f.id === 'a')).toEqual({ id: 'a', checked: ['Sells enterprise software', 'Why people buy is quoted'] });
    expect(out.facts.find((f) => f.id === 'b')).toEqual({ id: 'b', ruleOut: 'Fails "Sells enterprise software": "hand tools for hobbyists"' });
    expect(out.facts.find((f) => f.id === 'c')).toBeUndefined();
    expect(out.summary).toBe('2 checks met with a quote; 1 ruled out; 1 unknown; 2 quotes not found word for word, left open.');
  });

  it("confirms a quote of the option's facts as the judge saw them (compact JSON) or as Label: value", async () => {
    // The judge gets OPTIONS as compact JSON, so it quotes facts like "Employees":777 with no spaces.
    const options = [
      { id: 'a', name: 'Acme', facts: { Revenue: 85000000, Employees: 777, Founded: 2011 }, text: '' },
      { id: 'b', name: 'Bolt', facts: { Employees: { min: 1001, max: 5000 } }, text: '' },
    ];
    const checks = ['Headcount is between 1,000 and 5,000', 'Founded in 2016 or later'];
    const out = await verify([
      { id: 'a', check: 'Headcount is between 1,000 and 5,000', verdict: 'not met', quote: '"Revenue":85000000,"Employees":777', url: 'notebook' },
      { id: 'b', check: 'Headcount is between 1,000 and 5,000', verdict: 'met', quote: 'Employees: {"min": 1001, "max": 5000}', url: 'notebook' },
      { id: 'a', check: 'Founded in 2016 or later', verdict: 'not met', quote: '"Founded":2011,"Fit":68', url: 'notebook' },
    ], options, checks);
    expect(out.facts.find((f) => f.id === 'a')?.ruleOut).toBe('Fails "Headcount is between 1,000 and 5,000": "Revenue: 85000000, Employees: 777"');
    expect(out.facts.find((f) => f.id === 'b')).toEqual({ id: 'b', checked: ['Headcount is between 1,000 and 5,000'] });
    // A fact it doesn't have ("Fit") isn't confirmed; Bolt's founding year nothing answered.
    expect(out.summary).toBe('1 check met with a quote; 1 ruled out; 1 unknown; 1 quote not found word for word, left open.');
  });

  it('sends only the checks its own facts left open to the web, one item per option', async () => {
    const options = [
      { id: 'a', name: 'Acme', facts: { Website: 'https://acme.example', Employees: 300 }, sources: ['https://acme.example/about'], left: ['Headcount under 500', 'Why people buy is quoted'] },
      { id: 'b', name: 'Bolt', facts: {}, left: ['Headcount under 500'] },
      { id: 'c', name: 'Acme', facts: {}, left: ['Why people buy is quoted'] },
    ];
    const judge = [{ id: 'a', check: 'Headcount under 500', verdict: 'met', quote: '"Employees":300', url: 'notebook' }, { id: 'b', check: 'Headcount under 500', verdict: 'unknown' }];
    const out = await shellNode('pending', { UPSTREAM_JUDGE_RESULT: `<verdicts>${JSON.stringify(judge)}</verdicts>`, OPTIONS: JSON.stringify(options), CHECKS: JSON.stringify(['Headcount under 500', 'Why people buy is quoted']) });
    const p = JSON.parse(out.trim().split('\n').at(-1)!);
    expect(p.need_web).toBe(true);
    expect(JSON.parse(p.items_json)).toEqual([
      { subject: 'Acme (https://acme.example)', hint: 'Checks still open for it: Why people buy is quoted. Its pages: https://acme.example/about.' },
      { subject: 'Bolt', hint: 'Checks still open for it: Headcount under 500.' },
      { subject: 'Acme', hint: 'Checks still open for it: Why people buy is quoted.' },
    ]);
    expect(p.keys).toEqual({ c1: 'Why people buy is quoted', c2: 'Headcount under 500' });
    expect(p.subjects).toEqual({ 'acme (https://acme.example)': 'a', bolt: 'b', acme: 'c' });
    // All settled from their own facts: no web.
    const none = JSON.parse((await shellNode('pending', { UPSTREAM_JUDGE_RESULT: `<verdicts>${JSON.stringify([judge[0]])}</verdicts>`, OPTIONS: JSON.stringify([{ ...options[0], left: ['Headcount under 500'] }]), CHECKS: '[]' })).trim().split('\n').at(-1)!);
    expect(none.need_web).toBe(false);
  });

  it("ticks and rules out from the web research's answers, checking their quotes on the page", async () => {
    const url = await page('<p>Customers say they buy it to close the books in half the time.</p><p>We have 2,400 employees worldwide.</p>');
    const options = [
      { id: 'a', name: 'Acme', facts: {}, left: ['Why people buy is quoted', 'Headcount under 500'] },
      { id: 'b', name: 'Bolt', facts: {}, left: ['Why people buy is quoted'] },
    ];
    const checks = ['Why people buy is quoted', 'Headcount under 500'];
    const pending = { ok: true, keys: { c1: 'Why people buy is quoted', c2: 'Headcount under 500' }, subjects: { acme: 'a', bolt: 'b' } };
    const web = { headline: '2 of 2 researched.', results: [
      { subject: 'Acme', status: 'done', found: {
        c1: { value: 'met', source: url, quote: 'buy it to close the books in half the time' },
        c2: { value: 'not met', source: url, quote: 'We have 2,400 employees worldwide' },
      } },
      { subject: 'Bolt', status: 'done', found: { c1: { value: 'met', source: url, quote: 'words that are not on that page at all' } } },
    ] };
    const out = await verify([{ id: 'a', check: 'Headcount under 500', verdict: 'unknown' }], options, checks, {
      UPSTREAM_PENDING_RESULT: JSON.stringify(pending), UPSTREAM_WEB_RESULT: `ran\n${JSON.stringify(web)}`,
    });
    expect(out.facts.find((f) => f.id === 'a')).toEqual({ id: 'a', checked: ['Why people buy is quoted'], ruleOut: `Fails "Headcount under 500": "We have 2,400 employees worldwide" (${url})` });
    expect(out.facts.find((f) => f.id === 'b')).toBeUndefined();
    expect(out.summary).toBe('1 check met with a quote; 1 ruled out; 1 quote not found word for word, left open.');
  });

  it('gives a quote not on the downloaded page a second look, and ticks one seen on its screenshot, with the screenshot as evidence', async () => {
    const url = await page('<div id="app"></div>'); // its text only shows in a browser
    const options = [{ id: 'a', name: 'Acme', facts: {}, left: ['Why people buy is quoted', 'Headcount under 500'] }];
    const checks = ['Why people buy is quoted', 'Headcount under 500'];
    const pending = { ok: true, keys: { c1: 'Why people buy is quoted', c2: 'Headcount under 500' }, subjects: { acme: 'a' } };
    const web = { results: [{ subject: 'Acme', status: 'done', found: {
      c1: { value: 'met', source: url, quote: 'buy it to close the books in half the time' },
      c2: { value: 'not met', source: url, quote: 'We have 2,400 employees worldwide' },
    } }] };
    const env = { UPSTREAM_PENDING_RESULT: JSON.stringify(pending), UPSTREAM_WEB_RESULT: JSON.stringify(web) };
    // Nothing looked again: both stay open, and only the "met" goes to a second look (a screenshot never rules out).
    const before = await verify([], options, checks, env);
    expect(before.verified).toMatchObject({ any_second_look: true, second_look: [{ id: 'a', check: 'Why people buy is quoted', url }] });
    expect(before.facts).toEqual([]);
    expect(before.summary).toBe('0 checks met with a quote; 0 ruled out; 2 quotes not found word for word, left open.');
    // Seen on its screenshot: ticked, with the picture as evidence; a made-up proof address doesn't count.
    const seen = await verify([], options, checks, env, `<seen>${JSON.stringify([{ i: 0, seen: true, shown: 'They buy it to close the books in half the time', proof: '/runs/run-1/files/look-1.png' }])}</seen>`);
    expect(seen.facts).toEqual([{ id: 'a', checked: ['Why people buy is quoted'] }]);
    expect(seen.entries).toEqual([{ kind: 'evidence', title: 'Seen on a screenshot: Why people buy is quoted', body: `They buy it to close the books in half the time — ${url} (screenshot: /runs/run-1/files/look-1.png)` }]);
    expect(seen.summary).toBe('0 checks met with a quote; 0 ruled out; 1 seen on a screenshot of the page; 1 quote not found word for word, left open.');
    const fake = await verify([], options, checks, env, `<seen>${JSON.stringify([{ i: 0, seen: true, proof: 'https://evil.example/x.png' }])}</seen>`);
    expect(fake.facts).toEqual([]);
    // A site that refused the browser is named, so it's clear why its check stays open.
    const refused = await verify([], options, checks, env, `<seen>${JSON.stringify([{ i: 0, seen: false, blocked: true, proof: '/runs/run-1/files/look-1.png' }])}</seen>`);
    expect(refused.summary).toBe("0 checks met with a quote; 0 ruled out; 2 quotes not found word for word, left open; 127.0.0.1:" + new URL(url).port + " blocked a browser, so its page couldn't be checked by screenshot.");
  });
});

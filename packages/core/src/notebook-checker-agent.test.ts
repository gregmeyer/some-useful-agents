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

function verify(verdicts: unknown[], options: unknown[], checks: string[]): Promise<{ facts: Array<{ id: string; checked?: string[]; ruleOut?: string }>; summary: string }> {
  const node = parseAgent(yaml).nodes.find((n) => n.id === 'verify') as { command: string };
  return new Promise((resolve, reject) => {
    const p = spawn('bash', ['-c', node.command], { env: { ...process.env, UPSTREAM_JUDGE_RESULT: `<verdicts>${JSON.stringify(verdicts)}</verdicts>`, OPTIONS: JSON.stringify(options), CHECKS: JSON.stringify(checks) } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += String(d); });
    p.stderr.on('data', (d) => { err += String(d); });
    p.on('close', (code) => {
      if (code !== 0) { reject(new Error(err)); return; }
      resolve(JSON.parse(/<notebook>([\s\S]*)<\/notebook>/.exec(out)![1]) as never);
    });
  });
}

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
    // A fact it doesn't have ("Fit") isn't confirmed.
    expect(out.summary).toBe('1 check met with a quote; 1 ruled out; 1 quote not found word for word, left open.');
  });
});

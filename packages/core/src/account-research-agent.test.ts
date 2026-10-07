/**
 * The account-research example agent's last step is code, not a model: it
 * checks each quote is word for word in the job post the run fetched, keeps
 * scores in their rubric band and builds the <notebook> block. This runs that
 * step on fixture posts (no network, no model).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseAgent } from './agent-yaml.js';

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'account-research.yaml'), 'utf8');
const hasPython = spawnSync('python3', ['--version']).status === 0;

function verify(scored: unknown[], fields: unknown[] = []) {
  const agent = parseAgent(yaml);
  const node = agent.nodes.find((n) => n.id === 'verify')!;
  const discover = {
    searched: ['Postgres migration'], candidates: 3,
    sources: [{ name: 'Lever job posts', found: 3, status: 'found' }],
    companies: [
      { company: 'acme', board: 'lever', slug: 'acme', careers_url: 'https://jobs.lever.co/acme', open_roles: 4, signal_hits: 3,
        postings: [{ title: 'Staff DBRE', url: 'https://jobs.lever.co/acme/1', text: 'You will lead our Oracle-to-PostgreSQL migration\nacross 40 services.' }] },
      { company: 'globex', board: 'ashby', slug: 'globex', careers_url: 'https://jobs.ashbyhq.com/globex', open_roles: 2, signal_hits: 1,
        postings: [{ title: 'Platform Engineer', url: 'https://jobs.ashbyhq.com/globex/2', text: 'We run Kafka and are hiring a platform engineer.' }] },
      { company: 'initech', board: 'greenhouse', slug: 'initech', careers_url: 'https://boards.greenhouse.io/initech', open_roles: 1, signal_hits: 1,
        postings: [{ title: 'Sales', url: 'https://boards.greenhouse.io/initech/jobs/3', text: 'Sell printers.' }] },
    ],
  };
  const r = spawnSync('bash', ['-c', (node as { command: string }).command], {
    env: { ...process.env, UPSTREAM_DISCOVER_RESULT: JSON.stringify(discover), UPSTREAM_SCORE_RESULT: `<scored>${JSON.stringify(scored)}</scored>`, FIELDS: JSON.stringify(fields) },
    encoding: 'utf8',
  });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(/<notebook>([\s\S]*)<\/notebook>/.exec(r.stdout)![1]) as { entries: Array<{ kind: string; title: string; body?: string; data?: Record<string, unknown>; fingerprint?: string }>; fields?: Array<{ key: string; role?: string }> };
}

describe.skipIf(!hasPython)('account-research verify step', () => {
  it('keeps word-for-word quotes, lowers made-up ones to tier 3, leaves unfit out, and proposes fields', () => {
    const out = verify([
      // Quote spans a line break and uses a curly apostrophe-free match: whitespace is normalised.
      { slug: 'acme', company: 'Acme', headline: 'Oracle-to-Postgres migration in flight', fit: 91, quote: 'lead our Oracle-to-PostgreSQL migration across 40 services', quote_url: 'https://jobs.lever.co/acme/1', why: 'Migrating now.' },
      { slug: 'globex', company: 'Globex', headline: 'Kafka at scale', fit: 88, quote: 'We are migrating 2PB of Kafka topics', quote_url: 'https://jobs.ashbyhq.com/globex/2', why: 'Big Kafka.' },
      { slug: 'initech', company: 'Initech', fit: 10, why: 'Sells printers.' },
      { slug: 'not-fetched', company: 'Ghost', fit: 99, quote: 'anything at all here', why: 'Invented.' },
    ]);
    const options = out.entries.filter((e) => e.kind === 'option');
    expect(options.map((e) => e.title)).toEqual(['Acme: Oracle-to-Postgres migration in flight', 'Globex: Kafka at scale']);
    // Verified: fit carries the post as its source, tier 1.
    expect(options[0].data).toMatchObject({ company: 'Acme', post: 'https://jobs.lever.co/acme/1', fit: { value: 91, source: 'https://jobs.lever.co/acme/1' }, tier: 'Tier 1, immediate fit' });
    expect(options[0].fingerprint).toBe('lever:acme');
    // Not in the post: capped at 69 (tier 3), no source, said so.
    expect(options[1].data).toMatchObject({ post: 'https://jobs.ashbyhq.com/globex', fit: 69, tier: 'Tier 3, size and industry only' });
    expect(options[1].body).toContain("isn't in the post word for word");
    const note = out.entries.find((e) => e.kind === 'note')!;
    expect(note.title).toContain('Left out as unfit: Initech');
    expect(note.title).toContain('1 quote failed');
    expect(out.fields!.find((f) => f.role === 'score')!.key).toBe('fit');
    // The first link in an option's text is its own link, so the page's text-vs-facts repair leaves it alone.
    for (const o of options) expect(/https?:\/\/[^\s<>"'()]+/.exec(`${o.title}\n${o.body}`)![0].replace(/[.,;:!?]+$/, '')).toBe(o.data!.post);
  });

  it("uses the notebook's own field keys when it has them", () => {
    const out = verify(
      [{ slug: 'acme', company: 'Acme', headline: 'Migration', fit: 80, quote: 'Oracle-to-PostgreSQL migration', quote_url: 'https://jobs.lever.co/acme/1', why: 'x' }],
      [{ key: 'name', label: 'Name', type: 'text', role: 'org' }, { key: 'site', label: 'Site', type: 'url', role: 'link' }, { key: 'icp_fit', label: 'ICP fit', type: 'number', role: 'score' }],
    );
    expect(out.fields).toBeUndefined();
    expect(out.entries[0].data).toEqual({ name: 'Acme', site: 'https://jobs.lever.co/acme/1', icp_fit: { value: 80, source: 'https://jobs.lever.co/acme/1' } });
  });
});

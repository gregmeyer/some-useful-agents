/**
 * `/behaviors` routes.
 *
 * The load-bearing tests here are the XSS ones. A behavior body is untrusted
 * third-party Markdown — anyone can drop a file into `~/.agents/behaviors/` and
 * have it apply machine-wide — and it is the only content on this page that
 * becomes HTML rather than escaped text. If the sanitizer is ever bypassed,
 * these fail.
 */
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBehaviors } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3995;
const HDRS = { Host: `127.0.0.1:${PORT}`, Cookie: `${SESSION_COOKIE}=${TOKEN}` };

let specRoot: string;
let t: TestContext | undefined;

function writeSpec(root: string, name: string, opts: { front?: string; body?: string } = {}): void {
  const d = join(root, '.agents', 'behaviors', name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'BEHAVIOR.md'),
    `---\n${opts.front ?? `name: ${name}\ndescription: Spec for ${name}.`}\n---\n${opts.body ?? `# ${name}\n\nSome prose.`}`);
}

/** `wire: false` simulates a host that never configured discovery. */
async function makeApp(opts: { wire?: boolean } = {}) {
  t = await createTestContext({ port: PORT, prefix: 'sua-behaviors-route-', extra: ({ dir }) => (opts.wire === false ? {} : {
    loadBehaviors: () => loadBehaviors({
      scopes: [{ scope: 'project' as const, rootDir: dir, optional: true }],
    }),
  }) });
  specRoot = t.dir;
  const { ctx } = t;

  return buildDashboardApp(ctx);
}

const get = (app: Awaited<ReturnType<typeof makeApp>>, url: string) =>
  request(app).get(url).set(HDRS);

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

describe('GET /behaviors', () => {
  it('lists discovered specs with name, description and scope', async () => {
    const app = await makeApp();
    writeSpec(specRoot, 'cost-sensitive-actions');
    const res = await get(app, '/behaviors');
    expect(res.status).toBe(200);
    expect(res.text).toContain('cost-sensitive-actions');
    expect(res.text).toContain('Spec for cost-sensitive-actions.');
    expect(res.text).toContain('project');
  });

  it('names the searched root in the empty state', async () => {
    const app = await makeApp();
    const res = await get(app, '/behaviors');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No behavior specs');
    expect(res.text).toContain('.agents/behaviors');
  });

  it('renders diagnostics rather than hiding a broken spec', async () => {
    const app = await makeApp();
    writeSpec(specRoot, 'mismatch', { front: 'name: other-name\ndescription: d' });
    const res = await get(app, '/behaviors');
    expect(res.status).toBe(200);
    expect(res.text).toContain('behavior/name-dir-mismatch');
  });

  it('degrades to an explanatory page when discovery is not configured', async () => {
    const app = await makeApp({ wire: false });
    const res = await get(app, '/behaviors');
    expect(res.status).toBe(200);
    expect(res.text).toContain('not configured');
  });
});

describe('GET /behaviors/:name', () => {
  it('renders the body as Markdown', async () => {
    const app = await makeApp();
    writeSpec(specRoot, 'alpha', { body: '# Heading\n\n**Intent:** matters.' });
    const res = await get(app, '/behaviors/alpha');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<strong>Intent:</strong>');
  });

  it('shows provenance: scope, absolute path and hash', async () => {
    const app = await makeApp();
    writeSpec(specRoot, 'alpha');
    const res = await get(app, '/behaviors/alpha');
    expect(res.text).toContain('BEHAVIOR.md');
    expect(res.text).toContain('sha256');
  });

  it('redirects an unknown name back to the list', async () => {
    const app = await makeApp();
    const res = await get(app, '/behaviors/nope');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/behaviors');
  });

  it('neutralizes a hostile body — hostile markup becomes inert text', async () => {
    const app = await makeApp();
    writeSpec(specRoot, 'evil', {
      body: '# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))',
    });
    const res = await get(app, '/behaviors/evil');
    expect(res.status).toBe(200);

    // Assert on the ELEMENTS, not on the substring "onerror": the sanitizer
    // escapes hostile markup rather than deleting it, so the literal text
    // `&lt;img ... onerror=...&gt;` legitimately survives as inert prose. A
    // bare `not.toContain('onerror')` fails on that safe output — it tests the
    // wrong property and would push someone to "fix" a working sanitizer.
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).not.toMatch(/<img[^>]*onerror/i);
    expect(res.text).not.toMatch(/href\s*=\s*["']javascript:/i);

    // Positively confirm it was neutralized rather than silently dropped —
    // a reviewer should still see what the file actually says.
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).toContain('&lt;img');
  });

  it('escapes markup in the description rather than rendering it', async () => {
    // Only `body` takes the Markdown path; every other field is plain text.
    const app = await makeApp();
    writeSpec(specRoot, 'alpha', { front: 'name: alpha\ndescription: "<b>bold</b> and <script>x</script>"' });
    const res = await get(app, '/behaviors/alpha');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<b>bold</b>');
    expect(res.text).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('marks external links noreferrer nofollow', async () => {
    const app = await makeApp();
    writeSpec(specRoot, 'alpha', { body: '[docs](https://example.com)' });
    const res = await get(app, '/behaviors/alpha');
    expect(res.text).toContain('rel="noreferrer nofollow"');
  });
});

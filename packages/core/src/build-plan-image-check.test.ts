import { describe, it, expect } from 'vitest';
import {
  extractImageUrls,
  findDeadImageUrls,
  checkPlanImageUrls,
  formatDeadImageFeedback,
  formatImageCheckFeedback,
  type CheckUrlFn,
} from './build-plan-image-check.js';
import { buildPlanSchema, type BuildPlanInput } from './build-plan-schema.js';

/** A shell agent whose command bakes in the given image URLs. */
const yamlWithImages = (id: string, urls: string[]) => {
  const arr = urls.map((u) => `{\\"image\\":\\"${u}\\"}`).join(',');
  return `id: ${id}\nname: ${id} agent\nnodes:\n  - id: n1\n    type: shell\n    command: echo '[${arr}]'\n`;
};

function planFor(overrides: Partial<BuildPlanInput> = {}): ReturnType<typeof buildPlanSchema.parse> {
  return buildPlanSchema.parse({
    intent: 'agent',
    summary: 'A test plan',
    survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
    newAgents: [{ id: 'one', purpose: 'p', yaml: yamlWithImages('one', []) }],
    dashboard: null,
    questions: [],
    ...overrides,
  });
}

/** Build a checkUrl stub from a {url: status} map. Unlisted URLs → null. */
const stubChecker = (statuses: Record<string, number | null>): CheckUrlFn =>
  async (url: string) => (url in statuses ? statuses[url] : null);

describe('extractImageUrls', () => {
  it('extracts http(s) URLs by image extension', () => {
    const text =
      'see https://cdn.example.com/a.png and http://x.io/b.JPG and https://y.org/c.webp?w=1';
    expect(extractImageUrls(text)).toEqual([
      'https://cdn.example.com/a.png',
      'http://x.io/b.JPG',
      'https://y.org/c.webp?w=1',
    ]);
  });

  it('keeps URL-encoded segments intact', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/en/1/14/Rogue_%28Marvel_Comics%29.jpg';
    expect(extractImageUrls(`img: "${url}"`)).toEqual([url]);
  });

  it('de-dups while preserving first-seen order', () => {
    const text = 'a.png? no: https://h/a.png then https://h/b.gif then https://h/a.png';
    expect(extractImageUrls(text)).toEqual(['https://h/a.png', 'https://h/b.gif']);
  });

  it('ignores non-image URLs, data URIs, and template placeholders', () => {
    const text =
      'page https://h/index.html data:image/png;base64,AAAA src="{{outputs.image_url}}"';
    expect(extractImageUrls(text)).toEqual([]);
  });
});

describe('findDeadImageUrls', () => {
  it('flags only 404/410, not 200/3xx/403/429/5xx/network-error', async () => {
    const statuses: Record<string, number | null> = {
      'https://h/ok.png': 200,
      'https://h/redir.png': 301,
      'https://h/gone.png': 410,
      'https://h/missing.png': 404,
      'https://h/forbidden.png': 403,
      'https://h/ratelimited.png': 429,
      'https://h/server.png': 500,
      'https://h/neterr.png': null,
    };
    const dead = await findDeadImageUrls(Object.keys(statuses), { checkUrl: stubChecker(statuses) });
    expect(dead.map((d) => d.url)).toEqual(['https://h/gone.png', 'https://h/missing.png']);
    expect(dead).toContainEqual({ url: 'https://h/missing.png', status: 404 });
  });

  it('treats a throwing checker as inconclusive (not dead)', async () => {
    const throwing: CheckUrlFn = async () => { throw new Error('boom'); };
    const dead = await findDeadImageUrls(['https://h/x.png'], { checkUrl: throwing });
    expect(dead).toEqual([]);
  });

  it('de-dups URLs before checking', async () => {
    let calls = 0;
    const counting: CheckUrlFn = async () => { calls++; return 404; };
    const dead = await findDeadImageUrls(['https://h/x.png', 'https://h/x.png'], { checkUrl: counting });
    expect(calls).toBe(1);
    expect(dead).toHaveLength(1);
  });
});

describe('checkPlanImageUrls', () => {
  it('passes when every image URL resolves', async () => {
    const plan = planFor({
      newAgents: [{ id: 'one', purpose: 'p', yaml: yamlWithImages('one', ['https://h/ok.png']) }],
    });
    const result = await checkPlanImageUrls(plan, { checkUrl: stubChecker({ 'https://h/ok.png': 200 }) });
    expect(result.ok).toBe(true);
    expect(result.perAgent).toEqual([]);
  });

  it('groups dead links per newAgent', async () => {
    const plan = planFor({
      intent: 'dashboard-new',
      newAgents: [
        { id: 'one', purpose: 'p', yaml: yamlWithImages('one', ['https://h/dead.png', 'https://h/ok.png']) },
        { id: 'two', purpose: 'p', yaml: yamlWithImages('two', ['https://h/ok.png']) },
      ],
      dashboard: { id: 'user:d', name: 'D', sections: [{ title: 'T', agentIds: ['one', 'two'] }] },
    });
    const result = await checkPlanImageUrls(plan, {
      checkUrl: stubChecker({ 'https://h/dead.png': 404, 'https://h/ok.png': 200 }),
    });
    expect(result.ok).toBe(false);
    expect(result.perAgent).toHaveLength(1);
    expect(result.perAgent[0].agentId).toBe('one');
    expect(result.perAgent[0].dead.map((d) => d.url)).toEqual(['https://h/dead.png']);
  });

  it('fetches a URL shared across agents only once', async () => {
    let calls = 0;
    const counting: CheckUrlFn = async () => { calls++; return 404; };
    const plan = planFor({
      intent: 'dashboard-new',
      newAgents: [
        { id: 'one', purpose: 'p', yaml: yamlWithImages('one', ['https://h/shared.png']) },
        { id: 'two', purpose: 'p', yaml: yamlWithImages('two', ['https://h/shared.png']) },
      ],
      dashboard: { id: 'user:d', name: 'D', sections: [{ title: 'T', agentIds: ['one', 'two'] }] },
    });
    const result = await checkPlanImageUrls(plan, { checkUrl: counting });
    expect(calls).toBe(1);
    expect(result.perAgent.map((a) => a.agentId)).toEqual(['one', 'two']);
  });
});

describe('feedback formatters', () => {
  it('formatDeadImageFeedback lists each URL with its status', () => {
    const fb = formatDeadImageFeedback([{ url: 'https://h/x.png', status: 404 }]);
    expect(fb).toMatch(/Critic feedback/);
    expect(fb).toMatch(/https:\/\/h\/x\.png → HTTP 404/);
  });

  it('formatDeadImageFeedback is empty when nothing is dead', () => {
    expect(formatDeadImageFeedback([])).toBe('');
  });

  it('formatImageCheckFeedback groups per agent and is empty when ok', () => {
    expect(formatImageCheckFeedback({ ok: true, perAgent: [] })).toBe('');
    const fb = formatImageCheckFeedback({
      ok: false,
      perAgent: [{ agentId: 'one', dead: [{ url: 'https://h/x.png', status: 410 }] }],
    });
    expect(fb).toMatch(/newAgent "one"/);
    expect(fb).toMatch(/HTTP 410/);
  });
});

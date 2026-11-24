/**
 * Shared setup for the notebooks route tests (notebooks-*.test.ts): a test
 * dashboard on the shared harness, with stand-ins for every notebook agent.
 * Tests read and set the stand-ins' answers through `S` (an ES module's
 * `let` can't be assigned from another file).
 */
import { afterEach } from 'vitest';
import { DashboardsStore, InboxStore, PacksStore, type AgentStore, type RunStore } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { createTestContext, closeTestContext, TEST_COOKIE, type TestContext } from '../test-harness.js';

export const PORT = 3998;
export const COOKIE = TEST_COOKIE;

type Reply = ((inputs: Record<string, string>) => string | undefined) | undefined;

export const S = {
  dir: '',
  ctx: undefined as DashboardContext | undefined,
  runStore: undefined as unknown as RunStore,
  agentStore: undefined as unknown as AgentStore,
  suggesterSaw: '',
  facetsReply: undefined as Reply,
  checkerReply: undefined as Reply,
  finderReply: undefined as Reply,
  /** The drafter's answer when sua lays out a new notebook's steps (unset: none). */
  stepsReply: undefined as Reply,
  /** research-one's answer in a profile step. */
  researchReply: undefined as Reply,
  reconcilerReply: undefined as Reply,
  /** The notebook-page agent's answer (none: the shortlist stays). */
  pageReply: undefined as Reply,
  /** sua's writer's answer in a write step (none: no answer). */
  writerReply: undefined as Reply,
  /** sua's correction agent's answer (none: no answer). */
  correctionReply: undefined as Reply,
  facetsAsked: [] as Array<Record<string, string>>,
  researchAsked: [] as Array<Record<string, string>>,
  writerAsked: [] as Array<Record<string, string>>,
  correctionAsked: [] as Array<Record<string, string>>,
  pageAsked: [] as Array<Record<string, string>>,
};

let t: TestContext | undefined;

export async function makeApp(opts: { schedule?: string; allowHighFrequency?: boolean } = {}) {
  t = await createTestContext({ port: PORT, prefix: 'sua-notebooks-route-', extra: ({ dbPath }) => ({
    packsStore: new PacksStore(dbPath),
    dashboardsStore: new DashboardsStore(dbPath),
  }) });
  const ctx = t.ctx;
  S.dir = t.dir; S.ctx = ctx; S.runStore = ctx.runStore; S.agentStore = ctx.agentStore;
  ctx.inboxStore = InboxStore.fromHandle(ctx.runStore.databaseHandle());
  ctx.agentStore.createAgent({
    id: 'sched-agent',
    name: 'Sched Agent',
    status: 'active',
    source: 'local',
    mcp: false,
    schedule: opts.schedule,
    allowHighFrequency: opts.allowHighFrequency,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
  }, 'cli');
  Object.assign(ctx, {
    // Never a real model in tests: setup gets a fixed keeper answer.
    // Never a real picture model either.
    notebookPictureRun: async () => undefined,
    // Nor a real facet-labelling model: tests set S.facetsReply (and see what it was asked).
    notebookFacetsRun: async (inputs) => { S.facetsAsked.push(inputs); return S.facetsReply?.(inputs); },
    notebookPageRun: async (inputs) => { S.pageAsked.push(inputs); return S.pageReply?.(inputs); },
    notebookWriterRun: async (inputs) => { S.writerAsked.push(inputs); return S.writerReply?.(inputs); },
    notebookCorrectionRun: async (inputs) => { S.correctionAsked.push(inputs); return S.correctionReply?.(inputs); },
    // Nor a real checker: tests set S.checkerReply.
    notebookCheckerRun: async (inputs) => S.checkerReply?.(inputs),
    // Nor a real finder: tests set S.finderReply.
    notebookFinderRun: async (inputs) => S.finderReply?.(inputs),
    notebookResearchRun: async (inputs) => { S.researchAsked.push(inputs); return S.researchReply?.(inputs); },
    // Nor a real reconciler: no conflicts unless a test says so.
    notebookReconcilerRun: async (inputs) => S.reconcilerReply?.(inputs) ?? '<conflicts>{"conflicts": []}</conflicts>',
    notebookPersonPhotoCheck: async () => ({ why: 'no network in tests' }),
    // (only "staff role" notebooks get set up, so other tests keep the card layout).
    // The drafter answers with a fixed draft (its CHANGE, when given, lands in the title).
    // Laying out a new notebook's steps: tests set S.stepsReply.
    notebookDrafterRun: async (inputs) => inputs.CHANGE.startsWith('Lay out its "steps"') ? S.stepsReply?.(inputs) : `<draft>${JSON.stringify({
      title: inputs.CHANGE ? `Headphones (${inputs.CHANGE})` : 'Pick noise-cancelling headphones',
      statement: 'For flights, under $300.', params: ['under $300', 'over-ear', 'under $300'], criteria: ['One pair that fits', 'A decision recorded by Oct 20'],
      fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'rating', label: 'Rating', type: 'number', role: 'measure', better: 'higher' }, { key: 'bad key!', label: 'x' }],
      checks: ['Comfortable with glasses'], stages: ['Found', 'Shortlist', 'Bought'], pipeline: ['sched-agent', 'made-up-agent'], cadence: 'every morning', why: 'Assumed over-ear.',
      steps: [{ title: 'Find 5 pairs', kind: 'find', agent: 'sched-agent', target: 5 }, { title: 'Check comfort with glasses', kind: 'check', agent: '' }, { title: 'Research reviews', kind: 'source', agent: 'made-up-agent' }, { title: 'Pick one', kind: 'decide', target: 1 }],
    })}</draft>`,
    // The suggester sees your conversations (kept for the test to read) and answers with fixed pills.
    notebookSuggesterRun: async (inputs) => { S.suggesterSaw = inputs.CONVERSATIONS; return `<suggestions>${JSON.stringify([
      { label: 'Tires for the RAV4', text: 'Good tires for my 2012 RAV4, wet and dry', from: 'tires?' },
      { label: 'tires for the rav4', text: 'a duplicate label' },
      { label: 'Remote AI PM job', text: 'A remote senior AI PM job over $200k' },
      { label: '', text: 'no label' },
      { label: 'Rental', text: 'A 2-bed rental' }, { label: 'Fourth', text: 'one too many' },
    ])}</suggestions>`; },
    // A test run whose output is already a keeper answer is kept as-is.
    notebookKeeperRun: async (inputs) => inputs.RUN_OUTPUT.startsWith('<notebook>') ? inputs.RUN_OUTPUT : (inputs.SOURCE_AGENT === 'notebook-setup' && /staff role/i.test(inputs.NOTEBOOK)
      ? `<notebook>${JSON.stringify({ entries: [], fields: [{ key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher', range: true }, { key: 'company', label: 'Company', type: 'text', role: 'org' }], stages: ['Found', 'Applied', 'Offer'] })}</notebook>`
      : undefined),

  } satisfies Partial<DashboardContext>);
  return buildDashboardApp(ctx);
}

afterEach(async () => {
  // What a route started (pictures, facets, steps…) finishes before the stores close.
  const p = t?.provider as unknown as { running?: { size: number } } | undefined;
  const start = Date.now();
  while (p?.running?.size && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 20));
  const done = t;
  t = undefined; S.ctx = undefined; S.dir = '';
  await closeTestContext(done);
});

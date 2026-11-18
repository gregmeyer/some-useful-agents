/**
 * One sua turn per message where it can be (perceived-speed PR 3):
 * - a reply whose every action is refused isn't posted; the retry starts at once;
 * - an action that says what it did is the reply: no follow-up turn.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, MemorySecretsStore, type SpawnNodeFn, type InboxActionMeta } from '@some-useful-agents/core';
import { runTriageAgent, actionsReportedThemselves } from './inbox-engine.js';
import { InboxEventBus } from '../lib/inbox-event-bus.js';
import { TRIAGE_REJECTION_RECOVERY_NOTE } from './inbox-shared.js';

let dir = '';
let stores: { agentStore: AgentStore; inboxStore: InboxStore; runStore: RunStore } | undefined;

function setup(model?: SpawnNodeFn) {
  dir = mkdtempSync(join(tmpdir(), 'sua-one-turn-'));
  const db = join(dir, 'runs.db');
  stores = { agentStore: new AgentStore(db), inboxStore: new InboxStore(db), runStore: new RunStore(db) };
  return {
    ...stores,
    secretsStore: new MemorySecretsStore(),
    inboxEventBus: new InboxEventBus(),
    inboxTriageAbortControllers: new Map(),
    activeRuns: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dbPath: db,
    workflowSpawnNode: model,
  } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { stores?.agentStore.close(); stores?.inboxStore.close(); stores?.runStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = ''; stores = undefined;
});

const plan = (p: unknown) => `<plan>${JSON.stringify(p)}</plan>`;
const settle = async (until: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!until()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('a reply whose actions are all refused', () => {
  it("isn't posted: the refusal and the retry are, and only the retry's reply reaches them", async () => {
    let calls = 0;
    const model: SpawnNodeFn = async () => {
      calls++;
      return calls === 1
        // Asked from a notebook page, a Home change is refused (it's the wrong page).
        ? { exitCode: 0, result: plan({ recommendation: 'Done: I changed your Home page to lead with the picture.', actions: [{ type: 'adjust-surface', rationale: 'Lead Home with the picture', inputs: { SURFACE: 'home', CHANGE: 'picture first' } }] }) }
        : { exitCode: 0, result: plan({ recommendation: "That's this notebook's page, not Home: say the word and I'll change the notebook's page instead.", actions: [] }) };
    };
    const ctx = setup(model);
    const msg = ctx.inboxStore!.add({ priority: 'medium', source: 'manual', title: 'Notebook: hot dogs', body: 'From the notebook page.', contextJson: JSON.stringify({ page: { kind: 'notebook', title: 'Hot dogs', path: '/notebooks/hot-dogs' } }) });
    ctx.inboxStore!.addResponse(msg.id, 'user', 'lead with a picture of a hot dog');

    await runTriageAgent(ctx, msg.id);
    await settle(() => calls >= 2 && ctx.inboxStore!.listResponses(msg.id).some((r) => r.role === 'triage'));

    const rs = ctx.inboxStore!.listResponses(msg.id);
    const triage = rs.filter((r) => r.role === 'triage').map((r) => r.body);
    expect(triage).toHaveLength(1);
    expect(triage[0]).toContain("That's this notebook's page");
    expect(triage.join(' ')).not.toContain('I changed your Home page');
    expect(rs.some((r) => r.role === 'system' && r.body.startsWith('Refused action on `adjust-surface`'))).toBe(true);
    expect(rs.some((r) => r.role === 'system' && r.body === TRIAGE_REJECTION_RECOVERY_NOTE)).toBe(true);
    expect(rs.some((r) => r.role === 'action')).toBe(false);
  }, 20_000);
});

describe('an action that says what it did', () => {
  const action = (meta: Partial<InboxActionMeta>) => JSON.stringify({ kind: 'action', status: 'completed', inputs: {}, ...meta });

  it('is the reply when every action since their message reports itself and finished', () => {
    const ctx = setup();
    const msg = ctx.inboxStore!.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // An earlier exchange doesn't count.
    ctx.inboxStore!.addResponse(msg.id, 'action', 'old', action({ agentId: 'agent-editor', resultSummary: 'Edited.' }));
    ctx.inboxStore!.addResponse(msg.id, 'user', 'add these two');
    ctx.inboxStore!.addResponse(msg.id, 'action', 'add', action({ agentId: 'notebook-add', resultSummary: 'Added 2 to the notebook.' }));
    ctx.inboxStore!.addResponse(msg.id, 'action', 'page', action({ agentId: 'notebook-layout', resultSummary: "Changed [the notebook](/notebooks/x)'s page." }));
    expect(actionsReportedThemselves(ctx, msg.id)).toEqual(['Added 2 to the notebook.', "Changed [the notebook](/notebooks/x)'s page."]);
  });

  it('not when one failed, has nothing to say, or needs sua to read it (an analysis, an agent fix)', () => {
    const ctx = setup();
    const msg = ctx.inboxStore!.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const one = (meta: Partial<InboxActionMeta>) => {
      ctx.inboxStore!.addResponse(msg.id, 'user', 'again');
      ctx.inboxStore!.addResponse(msg.id, 'action', 'x', action(meta));
      return actionsReportedThemselves(ctx, msg.id);
    };
    expect(one({ agentId: 'notebook-add', status: 'failed', resultSummary: 'x' })).toBeUndefined();
    expect(one({ agentId: 'notebook-add', resultSummary: ' ' })).toBeUndefined();
    expect(one({ agentId: 'agent-editor', resultSummary: 'Edited.' })).toBeUndefined();
    expect(one({ agentId: 'agent-analyzer', resultSummary: 'It fails because…' })).toBeUndefined();
  });
});

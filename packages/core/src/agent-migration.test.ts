import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planMigration, applyMigration, type V1Input } from './agent-migration.js';
import { AgentStore } from './agent-store.js';
import type { AgentDefinition } from './types.js';

let dir: string;
let store: AgentStore;

function v1(overrides: Partial<AgentDefinition>, disabled = false): V1Input {
  return {
    disabled,
    agent: {
      name: overrides.name ?? 'anon',
      type: overrides.type ?? 'shell',
      source: overrides.source ?? 'local',
      ...overrides,
    } as AgentDefinition,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-migration-'));
  store = new AgentStore(join(dir, 'runs.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('planMigration — isolated agents', () => {
  it('produces one single-node DAG per isolated v1 agent', () => {
    const plan = planMigration([
      v1({ name: 'hello', type: 'shell', command: 'echo hi' }),
      v1({ name: 'world', type: 'shell', command: 'echo world' }),
    ]);
    expect(plan.warnings).toEqual([]);
    expect(plan.agents.map((a) => a.id).sort()).toEqual(['hello', 'world']);
    for (const pa of plan.agents) {
      expect(pa.nodes).toHaveLength(1);
      expect(pa.nodes[0].id).toBe(pa.id);
    }
  });

  it('preserves description, schedule, source, mcp, secrets', () => {
    const plan = planMigration([
      v1({
        name: 'nightly', type: 'shell', command: 'echo nightly',
        description: 'runs at midnight', schedule: '0 0 * * *',
        source: 'examples', mcp: true, secrets: ['SLACK_WEBHOOK'],
      }),
    ]);
    const [p] = plan.agents;
    expect(p.description).toBe('runs at midnight');
    expect(p.schedule).toBe('0 0 * * *');
    expect(p.source).toBe('examples');
    expect(p.mcp).toBe(true);
    expect(p.nodes[0].secrets).toEqual(['SLACK_WEBHOOK']);
  });

  it('maps disabled v1 agents to status=paused', () => {
    const plan = planMigration([v1({ name: 'paused-me', type: 'shell', command: 'echo' }, true)]);
    expect(plan.agents[0].status).toBe('paused');
  });
});

describe('planMigration — connected chains', () => {
  it('merges a linear 3-agent chain into one DAG named after the leaf', () => {
    const plan = planMigration([
      v1({ name: 'fetch', type: 'shell', command: 'echo headlines' }),
      v1({ name: 'summarize', type: 'claude-code', prompt: 'Summarize', dependsOn: ['fetch'], input: '{{outputs.fetch.result}}' }),
      v1({ name: 'post', type: 'shell', command: 'echo published', dependsOn: ['summarize'] }),
    ]);
    expect(plan.warnings).toEqual([]);
    expect(plan.agents).toHaveLength(1);
    const p = plan.agents[0];
    expect(p.id).toBe('post');
    expect(p.contributingV1Names).toEqual(['fetch', 'post', 'summarize']);
    expect(p.nodes.map((n) => n.id).sort()).toEqual(['fetch', 'post', 'summarize']);
    const summarize = p.nodes.find((n) => n.id === 'summarize')!;
    expect(summarize.dependsOn).toEqual(['fetch']);
    // v1 `{{outputs.X.result}}` → v2 `{{upstream.X.result}}` in the prompt
    expect(summarize.prompt).toContain('{{upstream.fetch.result}}');
  });

  it('merges a diamond DAG and picks the single leaf', () => {
    const plan = planMigration([
      v1({ name: 'top', type: 'shell', command: 'echo top' }),
      v1({ name: 'left', type: 'shell', command: 'echo left', dependsOn: ['top'] }),
      v1({ name: 'right', type: 'shell', command: 'echo right', dependsOn: ['top'] }),
      v1({ name: 'bottom', type: 'shell', command: 'echo bottom', dependsOn: ['left', 'right'] }),
    ]);
    expect(plan.agents).toHaveLength(1);
    expect(plan.agents[0].id).toBe('bottom');
    expect(plan.agents[0].nodes).toHaveLength(4);
  });

  it('emits unresolvable-chain warning for components with multiple leaves', () => {
    // Fan-out: one top, two leaves. Migration picks the alpha-first leaf as the name.
    const plan = planMigration([
      v1({ name: 'src', type: 'shell', command: 'echo' }),
      v1({ name: 'branch-a', type: 'shell', command: 'echo a', dependsOn: ['src'] }),
      v1({ name: 'branch-b', type: 'shell', command: 'echo b', dependsOn: ['src'] }),
    ]);
    expect(plan.warnings.some((w) => w.kind === 'unresolvable-chain' && /multiple leaves/.test(w.message))).toBe(true);
    expect(plan.agents).toHaveLength(1);
    expect(plan.agents[0].id).toBe('branch-a');
  });
});

describe('planMigration — defensive rejections', () => {
  it('refuses to merge agents with differing sources', () => {
    const plan = planMigration([
      v1({ name: 'fetch', type: 'shell', command: 'echo', source: 'community' }),
      v1({ name: 'use', type: 'claude-code', prompt: 'hi', source: 'local', dependsOn: ['fetch'] }),
    ]);
    expect(plan.agents).toHaveLength(0);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].kind).toBe('mixed-source');
  });

  it('warns on missing dependency (but still plans the isolated agents)', () => {
    const plan = planMigration([
      v1({ name: 'downstream', type: 'shell', command: 'echo', dependsOn: ['ghost'] }),
    ]);
    expect(plan.warnings.some((w) => w.kind === 'missing-dependency')).toBe(true);
    expect(plan.agents).toHaveLength(1);
    expect(plan.agents[0].id).toBe('downstream');
  });
});

describe('planMigration — template rewrite', () => {
  it('rewrites {{outputs.X.result}} to {{upstream.X.result}} in claude-code prompts', () => {
    const plan = planMigration([
      v1({ name: 'src', type: 'shell', command: 'echo' }),
      v1({
        name: 'dst', type: 'claude-code',
        prompt: 'Upstream said: {{outputs.src.result}}',
        dependsOn: ['src'],
      }),
    ]);
    const dst = plan.agents[0].nodes.find((n) => n.id === 'dst')!;
    expect(dst.prompt).toBe('Upstream said: {{upstream.src.result}}');
  });

  it('leaves non-outputs references alone', () => {
    const plan = planMigration([
      v1({ name: 'lone', type: 'claude-code', prompt: 'Zip: {{inputs.ZIP}}', inputs: { ZIP: { type: 'number' } } }),
    ]);
    const n = plan.agents[0].nodes[0];
    expect(n.prompt).toBe('Zip: {{inputs.ZIP}}');
  });

  it('appends v1 input: field (rewritten) onto the claude-code prompt', () => {
    const plan = planMigration([
      v1({ name: 'src', type: 'shell', command: 'echo' }),
      v1({
        name: 'dst', type: 'claude-code', prompt: 'Do something',
        input: '{{outputs.src.result}}',
        dependsOn: ['src'],
      }),
    ]);
    const dst = plan.agents[0].nodes.find((n) => n.id === 'dst')!;
    expect(dst.prompt).toContain('Do something');
    expect(dst.prompt).toContain('{{upstream.src.result}}');
    expect(dst.prompt).not.toContain('{{outputs.');
  });
});

describe('applyMigration', () => {
  it('inserts planned agents into the store idempotently', () => {
    const plan = planMigration([
      v1({ name: 'a', type: 'shell', command: 'echo a' }),
      v1({ name: 'b', type: 'shell', command: 'echo b' }),
    ]);
    const first = applyMigration(plan, store);
    expect(first.imported).toBe(2);
    expect(first.skipped).toBe(0);

    // Re-run: nothing changes, everything is skipped.
    const second = applyMigration(plan, store);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it('bumps the version when the DAG changes between plans', () => {
    const plan1 = planMigration([v1({ name: 'a', type: 'shell', command: 'echo v1' })]);
    applyMigration(plan1, store);
    expect(store.getAgent('a')!.version).toBe(1);

    const plan2 = planMigration([v1({ name: 'a', type: 'shell', command: 'echo v2' })]);
    applyMigration(plan2, store);
    expect(store.getAgent('a')!.version).toBe(2);
  });

  it('preserves the contributing names in the commit message', () => {
    const plan = planMigration([
      v1({ name: 'fetch', type: 'shell', command: 'echo' }),
      v1({ name: 'post', type: 'shell', command: 'echo', dependsOn: ['fetch'] }),
    ]);
    applyMigration(plan, store);
    const versions = store.listVersions('post');
    expect(versions[0].commitMessage).toContain('fetch');
    expect(versions[0].commitMessage).toContain('post');
  });
});

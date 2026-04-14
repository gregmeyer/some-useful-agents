import { describe, it, expect } from 'vitest';
import { agentV2Schema, extractUpstreamReferences } from './agent-v2-schema.js';

function validSingleNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hello',
    name: 'Hello',
    description: 'A greeter',
    nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
    ...overrides,
  };
}

describe('agentV2Schema — happy paths', () => {
  it('accepts a minimal single-node shell agent', () => {
    const r = agentV2Schema.safeParse(validSingleNode());
    expect(r.success).toBe(true);
  });

  it('applies sensible defaults', () => {
    const r = agentV2Schema.safeParse(validSingleNode());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('draft');
      expect(r.data.source).toBe('local');
      expect(r.data.mcp).toBe(false);
      expect(r.data.version).toBe(1);
    }
  });

  it('accepts a three-node DAG with declared dependencies', () => {
    const r = agentV2Schema.safeParse({
      id: 'news-digest',
      name: 'News Digest',
      nodes: [
        { id: 'fetch', type: 'shell', command: 'curl -s https://example.com' },
        { id: 'summarize', type: 'claude-code', prompt: 'Summarize: {{upstream.fetch.result}}', dependsOn: ['fetch'] },
        { id: 'post', type: 'shell', command: 'echo done', dependsOn: ['summarize'] },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts declared inputs and per-node references', () => {
    const r = agentV2Schema.safeParse({
      id: 'weather-verse',
      name: 'Weather verse',
      inputs: { ZIP: { type: 'number', required: true } },
      nodes: [
        {
          id: 'compose',
          type: 'claude-code',
          prompt: 'Weather for zip {{inputs.ZIP}}',
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe('agentV2Schema — rejections', () => {
  it('rejects agent id with uppercase', () => {
    const r = agentV2Schema.safeParse(validSingleNode({ id: 'HelloAgent' }));
    expect(r.success).toBe(false);
  });

  it('rejects empty nodes array', () => {
    const r = agentV2Schema.safeParse({ id: 'x', name: 'X', nodes: [] });
    expect(r.success).toBe(false);
  });

  it('rejects shell node without command', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [{ id: 'main', type: 'shell' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects claude-code node without prompt', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [{ id: 'main', type: 'claude-code' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate node ids', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [
        { id: 'a', type: 'shell', command: 'echo 1' },
        { id: 'a', type: 'shell', command: 'echo 2' },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /Duplicate node id/i.test(i.message))).toBe(true);
    }
  });

  it('rejects dependsOn on a non-existent node', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [{ id: 'a', type: 'shell', command: 'echo 1', dependsOn: ['phantom'] }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /dependsOn "phantom"/.test(i.message))).toBe(true);
    }
  });

  it('rejects self-dependency', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [{ id: 'a', type: 'shell', command: 'echo 1', dependsOn: ['a'] }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /cannot depend on itself/i.test(i.message))).toBe(true);
    }
  });

  it('rejects a 2-node cycle', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [
        { id: 'a', type: 'shell', command: 'echo 1', dependsOn: ['b'] },
        { id: 'b', type: 'shell', command: 'echo 2', dependsOn: ['a'] },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /Cycle detected/i.test(i.message))).toBe(true);
    }
  });

  it('rejects a 3-node cycle', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [
        { id: 'a', type: 'shell', command: 'echo 1', dependsOn: ['c'] },
        { id: 'b', type: 'shell', command: 'echo 2', dependsOn: ['a'] },
        { id: 'c', type: 'shell', command: 'echo 3', dependsOn: ['b'] },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects {{inputs.X}} reference to an undeclared input', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [{ id: 'a', type: 'claude-code', prompt: 'Hello {{inputs.MISSING}}' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects {{upstream.Y.result}} reference to a non-existent node', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [{ id: 'a', type: 'claude-code', prompt: '{{upstream.ghost.result}}' }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /not a node in this agent/i.test(i.message))).toBe(true);
    }
  });

  it('rejects {{upstream.Y.result}} when Y is not in the node\'s dependsOn', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [
        { id: 'a', type: 'shell', command: 'echo hello' },
        { id: 'b', type: 'claude-code', prompt: '{{upstream.a.result}}' }, // no dependsOn
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /does not declare "a" in its dependsOn/i.test(i.message))).toBe(true);
    }
  });

  it('rejects {{inputs.X}} inside a shell command (env-var convention)', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      inputs: { ZIP: { type: 'number' } },
      nodes: [{ id: 'a', type: 'shell', command: 'echo {{inputs.ZIP}}' }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /shell nodes access inputs via environment variables/i.test(i.message))).toBe(true);
    }
  });

  it('rejects {{upstream.X.result}} inside a shell command (env-var convention)', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      nodes: [
        { id: 'a', type: 'shell', command: 'echo hi' },
        { id: 'b', type: 'shell', command: 'echo {{upstream.a.result}}', dependsOn: ['a'] },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /\$UPSTREAM_A_RESULT/i.test(i.message))).toBe(true);
    }
  });

  it('rejects reserved input names (SENSITIVE_ENV_NAMES)', () => {
    const r = agentV2Schema.safeParse({
      id: 'x', name: 'X',
      inputs: { PATH: { type: 'string' } },
      nodes: [{ id: 'a', type: 'shell', command: 'echo hi' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects sub-minute schedule without allowHighFrequency', () => {
    const r = agentV2Schema.safeParse(validSingleNode({ schedule: '*/30 * * * * *' }));
    expect(r.success).toBe(false);
  });
});

describe('extractUpstreamReferences', () => {
  it('extracts a single reference', () => {
    expect([...extractUpstreamReferences('{{upstream.fetch.result}}')]).toEqual(['fetch']);
  });

  it('extracts multiple distinct references', () => {
    const refs = extractUpstreamReferences('X={{upstream.a.result}} Y={{upstream.b.result}}');
    expect([...refs].sort()).toEqual(['a', 'b']);
  });

  it('dedupes repeated references', () => {
    const refs = extractUpstreamReferences('{{upstream.a.result}} / {{upstream.a.result}}');
    expect([...refs]).toEqual(['a']);
  });

  it('ignores malformed references', () => {
    expect([...extractUpstreamReferences('{{upstream.a}}')]).toEqual([]);
    expect([...extractUpstreamReferences('{{upstream.a.other}}')]).toEqual([]);
  });
});

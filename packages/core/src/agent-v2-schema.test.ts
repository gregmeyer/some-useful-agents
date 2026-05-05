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

  it('accepts a file-write node with path + content', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      nodes: [
        { id: 'fetch', type: 'shell', command: 'curl https://example.com' },
        { id: 'save', type: 'file-write', path: 'out.md', content: 'static text', dependsOn: ['fetch'] },
      ],
    }));
    expect(r.success).toBe(true);
  });

  it('accepts file-write with append: true', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      nodes: [{ id: 'log', type: 'file-write', path: 'log.txt', content: 'entry\n', append: true }],
    }));
    expect(r.success).toBe(true);
  });

  it('accepts file-write content templating an upstream', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      nodes: [
        { id: 'fetch', type: 'shell', command: 'curl https://example.com' },
        { id: 'save', type: 'file-write', path: 'out.md', content: '{{upstream.fetch.result}}', dependsOn: ['fetch'] },
      ],
    }));
    expect(r.success).toBe(true);
  });

  it('rejects file-write missing path', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      nodes: [{ id: 'save', type: 'file-write', content: 'hi' }],
    }));
    expect(r.success).toBe(false);
  });

  it('rejects file-write missing content', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      nodes: [{ id: 'save', type: 'file-write', path: 'out.md' }],
    }));
    expect(r.success).toBe(false);
  });

  it('rejects file-write referencing an upstream not in dependsOn', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      nodes: [{ id: 'save', type: 'file-write', path: 'out.md', content: '{{upstream.phantom.result}}' }],
    }));
    expect(r.success).toBe(false);
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

  it('accepts declared outputs in lowercase_snake_case', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      outputs: {
        articles: { type: 'array', description: 'List of stories with title, url, score' },
        count: { type: 'number' },
        date: { type: 'string', description: 'ISO date the digest was built' },
      },
    }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.outputs?.articles?.type).toBe('array');
  });

  it('accepts output shorthand: bare string promotes to { type: string }', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      outputs: {
        url: 'string',
        count: 'number',
        articles: 'array',
        ok: 'boolean',
        meta: 'object',
      },
    }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.outputs?.url).toEqual({ type: 'string' });
      expect(r.data.outputs?.count).toEqual({ type: 'number' });
      expect(r.data.outputs?.articles).toEqual({ type: 'array' });
      expect(r.data.outputs?.ok).toEqual({ type: 'boolean' });
      expect(r.data.outputs?.meta).toEqual({ type: 'object' });
    }
  });

  it('accepts a mix of shorthand and verbose forms in the same outputs block', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      outputs: {
        url: 'string',
        count: { type: 'number', description: 'How many.' },
      },
    }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.outputs?.url).toEqual({ type: 'string' });
      expect(r.data.outputs?.count).toEqual({ type: 'number', description: 'How many.' });
    }
  });

  it('rejects shorthand string that is not a valid type', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      outputs: { x: 'date' },
    }));
    expect(r.success).toBe(false);
  });

  it('accepts a retry policy with all fields', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      retry: { attempts: 3, backoff: 'exponential', delaySeconds: 30, categories: ['timeout', 'spawn_failure'] },
    }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.retry?.attempts).toBe(3);
      expect(r.data.retry?.backoff).toBe('exponential');
    }
  });

  it('accepts a retry policy with only attempts (defaults applied at runtime)', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      retry: { attempts: 2 },
    }));
    expect(r.success).toBe(true);
  });

  it('rejects retry.attempts > 10 (sanity cap)', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      retry: { attempts: 100 },
    }));
    expect(r.success).toBe(false);
  });

  it('rejects retry.delaySeconds > 3600 (1 hour cap)', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      retry: { attempts: 3, delaySeconds: 99999 },
    }));
    expect(r.success).toBe(false);
  });

  it('rejects unknown retry.backoff mode', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      retry: { attempts: 3, backoff: 'jittered' as unknown },
    }));
    expect(r.success).toBe(false);
  });

  it('omits the outputs key when not declared', () => {
    const r = agentV2Schema.safeParse(validSingleNode());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.outputs).toBeUndefined();
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

  it('rejects UPPERCASE output names (must be lowercase_snake_case)', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      outputs: { ARTICLES: { type: 'array' } },
    }));
    expect(r.success).toBe(false);
  });

  it('rejects unknown output type', () => {
    const r = agentV2Schema.safeParse(validSingleNode({
      outputs: { x: { type: 'date' } as unknown },
    }));
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
  });

  it('extracts dot-path field references', () => {
    expect([...extractUpstreamReferences('{{upstream.a.headline}}')]).toEqual(['a']);
    expect([...extractUpstreamReferences('{{upstream.write-draft.graphic_type}}')]).toEqual(['write-draft']);
    expect([...extractUpstreamReferences('{{upstream.a.data.nested.field}}')]).toEqual(['a']);
  });
});

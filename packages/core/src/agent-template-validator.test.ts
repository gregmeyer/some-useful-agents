import { describe, it, expect } from 'vitest';
import { validateAgentTemplatePaths } from './agent-template-validator.js';
import type { Agent } from './agent-v2-types.js';
import type { ToolDefinition, ToolOutputField } from './tool-types.js';

const csvReadDef: ToolDefinition = {
  id: 'csv.customers.read',
  name: 'Read customers',
  source: 'builtin',
  inputs: {},
  outputs: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' } as ToolOutputField,
          email: { type: 'string' } as ToolOutputField,
          active: { type: 'boolean' } as ToolOutputField,
        },
      } as ToolOutputField,
    } as ToolOutputField,
    row_count: { type: 'number' } as ToolOutputField,
  },
  implementation: { type: 'builtin', builtinName: 'csv.customers.read' },
};

function agent(prompt: string): Agent {
  return {
    id: 'a',
    name: 'a',
    version: 1,
    status: 'active' as const,
    source: 'local' as const,
    schedule: 'manual',
    nodes: [
      { id: 'fetch', type: 'claude-code' as const, tool: 'csv.customers.read' },
      { id: 'consume', type: 'claude-code' as const, prompt, dependsOn: ['fetch'] },
    ],
  } as unknown as Agent;
}

const resolver = (id: string) => (id === 'csv.customers.read' ? csvReadDef : undefined);

describe('validateAgentTemplatePaths', () => {
  it('accepts a valid dot-path through array.items.properties', () => {
    const issues = validateAgentTemplatePaths(agent('Email: {{upstream.fetch.rows.0.email}}'), { resolveTool: resolver });
    expect(issues).toEqual([]);
  });

  it('always accepts {{upstream.X.result}}', () => {
    const issues = validateAgentTemplatePaths(agent('{{upstream.fetch.result}}'), { resolveTool: resolver });
    expect(issues).toEqual([]);
  });

  it('flags a column typo with a Did-you-mean suggestion', () => {
    const issues = validateAgentTemplatePaths(agent('{{upstream.fetch.rows.0.emial}}'), { resolveTool: resolver });
    expect(issues).toHaveLength(1);
    expect(issues[0].upstreamNodeId).toBe('fetch');
    expect(issues[0].fieldPath).toBe('rows.0.emial');
    expect(issues[0].reason).toContain('"emial"');
    expect(issues[0].reason).toContain('email');
  });

  it('flags an unknown top-level output field', () => {
    const issues = validateAgentTemplatePaths(agent('{{upstream.fetch.bogus}}'), { resolveTool: resolver });
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toContain('"bogus" is not declared');
  });

  it('flags indexing an array with a non-numeric segment', () => {
    const issues = validateAgentTemplatePaths(agent('{{upstream.fetch.rows.first.email}}'), { resolveTool: resolver });
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toContain('array');
  });

  it('is lenient when the upstream tool is unknown', () => {
    const issues = validateAgentTemplatePaths(agent('{{upstream.fetch.rows.0.anything}}'), { resolveTool: () => undefined });
    expect(issues).toEqual([]);
  });

  it('is lenient when the upstream tool lacks items/properties', () => {
    const bareDef: ToolDefinition = {
      ...csvReadDef,
      outputs: { rows: { type: 'array' } as ToolOutputField },
    };
    const issues = validateAgentTemplatePaths(
      agent('{{upstream.fetch.rows.0.email}}'),
      { resolveTool: (id) => (id === 'csv.customers.read' ? bareDef : undefined) },
    );
    expect(issues).toEqual([]);
  });

  it('walks templates in env, content, path, and toolInputs', () => {
    const a: Agent = {
      id: 'a', name: 'a', version: 1, status: 'active' as const, source: 'local' as const,
      schedule: 'manual',
      nodes: [
        { id: 'fetch', type: 'claude-code' as const, tool: 'csv.customers.read' },
        {
          id: 'sink', type: 'file-write' as const, dependsOn: ['fetch'],
          path: 'out-{{upstream.fetch.rows.0.emial}}.txt',
          content: '{{upstream.fetch.rows.0.email}}',
          env: { TARGET: '{{upstream.fetch.rows.0.also_bad}}' },
        },
      ],
    } as unknown as Agent;
    const issues = validateAgentTemplatePaths(a, { resolveTool: resolver });
    const fields = issues.map((i) => i.field).sort();
    expect(fields).toEqual(['env.TARGET', 'path']);
  });
});

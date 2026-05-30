import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { computeProviderUsage } from './provider-usage.js';

const mkAgent = (id: string, partial: Partial<Agent>): Agent => ({
  id,
  name: id,
  status: 'active',
  source: 'local',
  mcp: false,
  version: 1,
  nodes: [],
  ...partial,
} as Agent);

describe('computeProviderUsage', () => {
  it('returns one row per provider, even when no agents use them', () => {
    const rows = computeProviderUsage([]);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(['apple-foundation-models', 'claude', 'codex']);
    for (const r of rows) {
      expect(r.agentCount).toBe(0);
      expect(typeof r.installed).toBe('boolean');
    }
  });

  it('counts an agent under its agent-level default provider', () => {
    const agents = [
      mkAgent('a1', {
        provider: 'codex',
        nodes: [{ id: 'main', type: 'llm-prompt', prompt: 'hi' }] as Agent['nodes'],
      }),
    ];
    const rows = computeProviderUsage(agents);
    const codex = rows.find((r) => r.id === 'codex')!;
    const claude = rows.find((r) => r.id === 'claude')!;
    expect(codex.agentCount).toBe(1);
    expect(claude.agentCount).toBe(0);
  });

  it('honors node-level provider override over agent default', () => {
    const agents = [
      mkAgent('a1', {
        provider: 'claude',
        nodes: [
          { id: 'a', type: 'llm-prompt', prompt: 'x', provider: 'codex' },
        ] as Agent['nodes'],
      }),
    ];
    const rows = computeProviderUsage(agents);
    expect(rows.find((r) => r.id === 'codex')!.agentCount).toBe(1);
    expect(rows.find((r) => r.id === 'claude')!.agentCount).toBe(0);
  });

  it('counts an agent once per distinct provider, regardless of node count', () => {
    const agents = [
      mkAgent('a1', {
        provider: 'claude',
        nodes: [
          { id: 'a', type: 'llm-prompt', prompt: 'x' },
          { id: 'b', type: 'llm-prompt', prompt: 'y' },
          { id: 'c', type: 'claude-code', prompt: 'z' },
        ] as Agent['nodes'],
      }),
    ];
    const rows = computeProviderUsage(agents);
    expect(rows.find((r) => r.id === 'claude')!.agentCount).toBe(1);
  });

  it('counts an agent under two providers when it mixes node-level overrides', () => {
    const agents = [
      mkAgent('a1', {
        provider: 'claude',
        nodes: [
          { id: 'a', type: 'llm-prompt', prompt: 'x' },               // → claude (default)
          { id: 'b', type: 'llm-prompt', prompt: 'y', provider: 'codex' }, // → codex
        ] as Agent['nodes'],
      }),
    ];
    const rows = computeProviderUsage(agents);
    expect(rows.find((r) => r.id === 'claude')!.agentCount).toBe(1);
    expect(rows.find((r) => r.id === 'codex')!.agentCount).toBe(1);
  });

  it('accepts the legacy claude-code node type as an LLM-prompt node', () => {
    const agents = [
      mkAgent('a1', { nodes: [{ id: 'main', type: 'claude-code', prompt: 'hi' }] as Agent['nodes'] }),
    ];
    expect(computeProviderUsage(agents).find((r) => r.id === 'claude')!.agentCount).toBe(1);
  });

  it('ignores non-LLM node types', () => {
    const agents = [
      mkAgent('a1', { nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }] as Agent['nodes'] }),
    ];
    for (const r of computeProviderUsage(agents)) {
      expect(r.agentCount).toBe(0);
    }
  });
});

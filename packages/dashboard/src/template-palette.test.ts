import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VariablesStore } from '@some-useful-agents/core';
import type { Agent } from '@some-useful-agents/core';
import { computePaletteSuggestions } from './views/template-palette.js';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    status: 'active',
    source: 'local',
    version: 1,
    nodes: [
      { id: 'step-a', type: 'shell', command: 'echo a' },
      { id: 'step-b', type: 'claude-code', prompt: 'hello', dependsOn: ['step-a'] },
    ],
    ...overrides,
  };
}

describe('computePaletteSuggestions', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'palette-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns upstreams, inputs, secrets, and empty vars when no store', () => {
    const agent = makeAgent({
      inputs: { ZIP: { type: 'number', required: true } },
    });
    const result = computePaletteSuggestions(agent, { nodeSecrets: ['MY_KEY'] });
    expect(result.upstreams).toEqual(['step-a', 'step-b']);
    expect(result.inputs).toEqual(['ZIP']);
    expect(result.secrets).toEqual(['MY_KEY']);
    expect(result.vars).toEqual([]);
  });

  it('includes global variable names when variablesStore is provided', () => {
    const store = new VariablesStore(join(dir, 'variables.json'));
    store.set('API_URL', 'https://api.example.com', 'Shared API URL');
    store.set('REGION', 'us-east-1');

    const agent = makeAgent();
    const result = computePaletteSuggestions(agent, { variablesStore: store });
    expect(result.vars).toEqual(['API_URL', 'REGION']);
  });

  it('excludes the current node from upstreams', () => {
    const agent = makeAgent();
    const result = computePaletteSuggestions(agent, { excludeNodeId: 'step-a' });
    expect(result.upstreams).toEqual(['step-b']);
  });
});

import { describe, it, expect } from 'vitest';
import { NODE_CATALOG, listNodeContracts, getNodeContract } from './node-catalog.js';
import type { NodeType } from './agent-v2-types.js';

// Forcing function: every NodeType must have a catalog entry. Adding a new
// node type without a contract should fail this test, prompting the author
// to document it.
const ALL_NODE_TYPES: NodeType[] = [
  'shell',
  'claude-code',
  'conditional',
  'switch',
  'loop',
  'agent-invoke',
  'branch',
  'end',
  'break',
];

describe('node catalog', () => {
  it('has an entry for every NodeType', () => {
    for (const t of ALL_NODE_TYPES) {
      expect(NODE_CATALOG[t], `missing catalog entry for ${t}`).toBeDefined();
      expect(NODE_CATALOG[t].type).toBe(t);
    }
  });

  it('every contract has a non-empty description', () => {
    for (const t of ALL_NODE_TYPES) {
      expect(NODE_CATALOG[t].description.length).toBeGreaterThan(10);
    }
  });

  it('every contract has at least one input', () => {
    for (const t of ALL_NODE_TYPES) {
      expect(NODE_CATALOG[t].inputs.length).toBeGreaterThan(0);
    }
  });

  it('every contract has at least 2 use_when bullets', () => {
    for (const t of ALL_NODE_TYPES) {
      expect(NODE_CATALOG[t].use_when.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every contract has a non-empty example', () => {
    for (const t of ALL_NODE_TYPES) {
      const ex = NODE_CATALOG[t].example;
      expect(ex.length).toBeGreaterThan(0);
      // Example should reference the node type itself.
      expect(ex).toContain(`type: ${t}`);
    }
  });

  it('listNodeContracts returns sorted entries', () => {
    const list = listNodeContracts();
    const types = list.map((c) => c.type);
    const sorted = [...types].sort();
    expect(types).toEqual(sorted);
    expect(list.length).toBe(ALL_NODE_TYPES.length);
  });

  it('getNodeContract returns the right entry by type', () => {
    expect(getNodeContract('shell')?.type).toBe('shell');
    expect(getNodeContract('claude-code')?.type).toBe('claude-code');
    expect(getNodeContract('agent-invoke')?.type).toBe('agent-invoke');
  });

  it('getNodeContract returns undefined for unknown types', () => {
    expect(getNodeContract('not-a-node-type')).toBeUndefined();
    expect(getNodeContract('')).toBeUndefined();
  });
});

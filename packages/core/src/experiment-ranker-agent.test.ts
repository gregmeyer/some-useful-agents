/**
 * The experiment-ranker example agent: one model node that ranks a fixed
 * list of items into a <ranking> block of ids.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from './agent-yaml.js';
import { SYSTEM_AGENT_IDS } from './items/system-agents.js';

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'experiment-ranker.yaml'), 'utf8');

describe('experiment-ranker agent', () => {
  it('parses, is a system agent, and asks one model node for a <ranking> block', () => {
    const agent = parseAgent(yaml);
    expect(agent.id).toBe('experiment-ranker');
    expect(SYSTEM_AGENT_IDS.has(agent.id)).toBe(true);
    expect(Object.keys(agent.inputs ?? {})).toEqual(['ITEMS', 'PREFERENCES', 'INSTRUCTIONS', 'ERRORS']);
    expect(agent.nodes).toHaveLength(1);
    const node = agent.nodes[0] as { type: string; maxTurns?: number; prompt: string; outputContract?: { mustMatch?: string } };
    expect(node).toMatchObject({ type: 'llm-prompt', maxTurns: 1 });
    for (const input of ['ITEMS', 'PREFERENCES', 'INSTRUCTIONS', 'ERRORS']) expect(node.prompt).toContain(`{{inputs.${input}}}`);
    // It ranks from what it is given alone, and every item once.
    expect(node.prompt).toContain('Use ONLY the facts given for each item.');
    expect(node.prompt).toContain('Rank EVERY item exactly once.');
    expect(new RegExp(node.outputContract!.mustMatch!).test('<ranking>\n["a", "b"]\n</ranking>')).toBe(true);
  });
});

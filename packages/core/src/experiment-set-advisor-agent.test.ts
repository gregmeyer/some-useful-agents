/**
 * The experiment-set-advisor example agent: one model node that reads an
 * experiment's question against the operator's notebooks into an <advice>
 * block.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from './agent-yaml.js';
import { SYSTEM_AGENT_IDS } from './items/system-agents.js';

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'experiment-set-advisor.yaml'), 'utf8');

describe('experiment-set-advisor agent', () => {
  it('parses, is a system agent, and may only name facts and sets it was given', () => {
    const agent = parseAgent(yaml);
    expect(agent.id).toBe('experiment-set-advisor');
    expect(SYSTEM_AGENT_IDS.has(agent.id)).toBe(true);
    expect(Object.keys(agent.inputs ?? {})).toEqual(['QUESTION', 'CHANGES', 'SETS', 'ERRORS']);
    expect(agent.nodes).toHaveLength(1);
    const node = agent.nodes[0] as { type: string; maxTurns?: number; prompt: string; outputContract?: { mustMatch?: string } };
    expect(node).toMatchObject({ type: 'llm-prompt', maxTurns: 1 });
    for (const input of ['QUESTION', 'CHANGES', 'SETS', 'ERRORS']) expect(node.prompt).toContain(`{{inputs.${input}}}`);
    expect(node.prompt).toContain('Use only what is in SETS.');
    expect(node.prompt).toContain('"turnsOn" labels must be copied exactly from a "facts" list.');
    expect(new RegExp(node.outputContract!.mustMatch!).test('<advice>\n{"turnsOn": [], "pick": "", "why": "x", "missing": []}\n</advice>')).toBe(true);
  });
});

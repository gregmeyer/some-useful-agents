/**
 * The experiment-judge example agent: one model node that scores one
 * ranking against a rubric into a <score> block.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from './agent-yaml.js';
import { SYSTEM_AGENT_IDS } from './items/system-agents.js';

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'experiment-judge.yaml'), 'utf8');

describe('experiment-judge agent', () => {
  it('parses, is a system agent, and is never told which build made the result', () => {
    const agent = parseAgent(yaml);
    expect(agent.id).toBe('experiment-judge');
    expect(SYSTEM_AGENT_IDS.has(agent.id)).toBe(true);
    expect(Object.keys(agent.inputs ?? {})).toEqual(['RUBRIC', 'ITEMS', 'RANKING', 'PREFERENCES', 'ERRORS']);
    expect(agent.nodes).toHaveLength(1);
    const node = agent.nodes[0] as { type: string; maxTurns?: number; prompt: string; outputContract?: { mustMatch?: string } };
    expect(node).toMatchObject({ type: 'llm-prompt', maxTurns: 1 });
    for (const input of ['RUBRIC', 'ITEMS', 'RANKING', 'PREFERENCES', 'ERRORS']) expect(node.prompt).toContain(`{{inputs.${input}}}`);
    expect(node.prompt).not.toContain('INSTRUCTIONS');
    expect(node.prompt).toContain('you are not told how the ranking was made');
    expect(node.prompt).toContain('Judge ONLY from the facts given for each item.');
    expect(new RegExp(node.outputContract!.mustMatch!).test('<score>\n{"score": 0.5, "reason": "x", "cites": ["a"]}\n</score>')).toBe(true);
  });
});

/**
 * The notebook-tagger example agent: one model node that answers with a
 * <tags> block, taking the notebooks and the tags already in use.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from './agent-yaml.js';
import { SYSTEM_AGENT_IDS } from './items/system-agents.js';

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'notebook-tagger.yaml'), 'utf8');

describe('notebook-tagger agent', () => {
  it('parses, is a system agent, and asks one model node for a <tags> block', () => {
    const agent = parseAgent(yaml);
    expect(agent.id).toBe('notebook-tagger');
    expect(SYSTEM_AGENT_IDS.has(agent.id)).toBe(true);
    expect(Object.keys(agent.inputs ?? {})).toEqual(['NOTEBOOKS', 'VOCABULARY']);
    expect(agent.nodes).toHaveLength(1);
    const node = agent.nodes[0] as { type: string; maxTurns?: number; prompt: string; outputContract?: { mustMatch?: string } };
    expect(node).toMatchObject({ type: 'llm-prompt', maxTurns: 1 });
    expect(node.prompt).toContain('{{inputs.NOTEBOOKS}}');
    expect(node.prompt).toContain('{{inputs.VOCABULARY}}');
    expect(new RegExp(node.outputContract!.mustMatch!).test('<tags>\n{"items": []}\n</tags>')).toBe(true);
  });
});

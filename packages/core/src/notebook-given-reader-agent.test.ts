/**
 * The notebook-given-reader example agent: one model node that reads what
 * someone pasted for a notebook into a <read> block of quoted facts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from './agent-yaml.js';
import { SYSTEM_AGENT_IDS } from './items/system-agents.js';

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'notebook-given-reader.yaml'), 'utf8');

describe('notebook-given-reader agent', () => {
  it('parses, is a system agent, and asks one model node for a <read> block', () => {
    const agent = parseAgent(yaml);
    expect(agent.id).toBe('notebook-given-reader');
    expect(SYSTEM_AGENT_IDS.has(agent.id)).toBe(true);
    expect(Object.keys(agent.inputs ?? {})).toEqual(['LABEL', 'FOR', 'TEXT', 'ERRORS']);
    expect(agent.nodes).toHaveLength(1);
    const node = agent.nodes[0] as { type: string; maxTurns?: number; prompt: string; outputContract?: { mustMatch?: string } };
    expect(node).toMatchObject({ type: 'llm-prompt', maxTurns: 1 });
    for (const input of ['LABEL', 'FOR', 'TEXT', 'ERRORS']) expect(node.prompt).toContain(`{{inputs.${input}}}`);
    // It reads only the paste, and every fact carries the paste's own words.
    expect(node.prompt).toContain('Use ONLY the paste.');
    expect(node.prompt).toContain('copied from the paste EXACTLY as written');
    expect(new RegExp(node.outputContract!.mustMatch!).test('<read>\n{"summary": "x", "facts": []}\n</read>')).toBe(true);
  });
});

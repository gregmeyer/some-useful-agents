/**
 * The notebook-tldr example agent: one model node that answers with a
 * <tldr> block, given the picture in words, the choices and the ask.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from './agent-yaml.js';
import { SYSTEM_AGENT_IDS } from './items/system-agents.js';

const yaml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples', 'notebook-tldr.yaml'), 'utf8');

describe('notebook-tldr agent', () => {
  it('parses, is a system agent, and asks one model node for a <tldr> block', () => {
    const agent = parseAgent(yaml);
    expect(agent.id).toBe('notebook-tldr');
    expect(SYSTEM_AGENT_IDS.has(agent.id)).toBe(true);
    expect(Object.keys(agent.inputs ?? {})).toEqual(['NOTEBOOK', 'CARD', 'OPTIONS', 'ASK', 'CURRENT', 'ERRORS']);
    expect(agent.nodes).toHaveLength(1);
    const node = agent.nodes[0] as { type: string; maxTurns?: number; prompt: string; outputContract?: { mustMatch?: string } };
    expect(node).toMatchObject({ type: 'llm-prompt', maxTurns: 1 });
    for (const input of ['NOTEBOOK', 'CARD', 'OPTIONS', 'ASK', 'CURRENT', 'ERRORS']) expect(node.prompt).toContain(`{{inputs.${input}}}`);
    // It chooses and may write two lines; it never supplies a number.
    expect(node.prompt).toContain("You choose how; you don't draw it.");
    expect(node.prompt).toContain('every number or name in them must be in CARD');
    expect(new RegExp(node.outputContract!.mustMatch!).test('<tldr>\n{"size": "landscape"}\n</tldr>')).toBe(true);
  });
});

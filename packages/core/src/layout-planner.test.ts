import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgent } from './agent-yaml.js';
import { layoutPlanSchema } from './layout-plan-schema.js';

/**
 * Find the embedded `<plan>{...}</plan>` JSON example in the prompt
 * text. Unlike `extractPlanJson` (which matches any <plan> block —
 * including the prose mention "Wrap the JSON in <plan>…</plan> tags"),
 * this regex requires a `{` immediately after the opening tag so it
 * only matches a real JSON example.
 */
function extractPlanExample(promptText: string): string | null {
  const m = /<plan>\s*(\{[\s\S]*?\})\s*<\/plan>/i.exec(promptText);
  return m ? m[1] : null;
}

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const LAYOUT_PLANNER_PATH = join(REPO_ROOT, 'agents', 'examples', 'layout-planner.yaml');

describe('layout-planner.yaml', () => {
  const yamlText = readFileSync(LAYOUT_PLANNER_PATH, 'utf-8');

  it('parses cleanly through the v2 agent schema', () => {
    const agent = parseAgent(yamlText);
    expect(agent.id).toBe('layout-planner');
    expect(agent.source).toBe('examples');
    expect(agent.nodes).toHaveLength(1);
    expect(agent.nodes[0].type).toBe('llm-prompt');
  });

  it('declares the inputs the route handler will inject', () => {
    const agent = parseAgent(yamlText);
    const inputs = agent.inputs ?? {};
    expect(inputs).toHaveProperty('CURRENT_LAYOUT');
    expect(inputs).toHaveProperty('AGENT_METADATA');
    expect(inputs).toHaveProperty('FOCUS');
    expect(inputs.AGENT_METADATA.required).toBe(true);
  });

  it("embeds an example <plan> block in the prompt that validates against layoutPlanSchema", () => {
    const agent = parseAgent(yamlText);
    const prompt = agent.nodes[0].prompt ?? '';
    const planJson = extractPlanExample(prompt);
    expect(planJson, 'no <plan>{...}</plan> JSON example found in the prompt').not.toBeNull();

    const parsed = JSON.parse(planJson!);
    const r = layoutPlanSchema.safeParse(parsed);
    if (!r.success) {
      // Surface the issues so a contributor editing the prompt sees
      // exactly which schema rule they broke.
      console.log('layout-planner prompt example failed schema validation:', r.error.issues);
    }
    expect(r.success).toBe(true);
  });
});

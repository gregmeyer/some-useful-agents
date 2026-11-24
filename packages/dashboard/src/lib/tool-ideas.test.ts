import { describe, it, expect } from 'vitest';
import type { Agent, AgentNode, ToolDefinition } from '@some-useful-agents/core';
import { toolIdeasFromAgents, toolIdeaFromStep } from './tool-ideas.js';

const agent = (id: string, nodes: AgentNode[], over: Partial<Agent> = {}): Agent =>
  ({ id, name: id.replace(/-/g, ' '), status: 'active', source: 'local', mcp: false, version: 1, nodes, ...over });
const sh = (id: string, command: string): AgentNode => ({ id, type: 'shell', command });

const FETCH = (n: number) => `curl -s "https://api.stories.test/v1/top?limit=${n}" | jq '.items[] | {title: .title, url: .url}'`;

describe('toolIdeasFromAgents', () => {
  it('suggests a tool for an address several agents fetch', () => {
    const ideas = toolIdeasFromAgents([
      agent('top-three', [sh('fetch', FETCH(3))]),
      agent('top-ten', [sh('get', FETCH(10))]),
      agent('other', [sh('x', 'python3 -c "print(1 + 2 + 3 + 4 + 5)"')]),
    ]);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ key: 'host:api.stories.test/v1', label: 'Fetch from api.stories.test', agents: ['top-three', 'top-ten'] });
    expect(ideas[0].text).toMatch(/https:\/\/api\.stories\.test\/v1, taking limit as inputs/);
    expect(ideas[0].text).toMatch(/title, url/);
    expect(ideas[0].from).toMatch(/2 of your agents fetch this/);
  });

  it('suggests a tool for near-identical commands', () => {
    const cmd = 'python3 scripts/score.py --input data/latest.csv --column price --threshold 50';
    const ideas = toolIdeasFromAgents([
      agent('a', [sh('s', cmd)]),
      agent('b', [sh('s', cmd.replace('50', '75'))]),
    ]);
    expect(ideas).toHaveLength(1);
    expect(ideas[0].key).toMatch(/^cmd:/);
    expect(ideas[0].text).toMatch(/values they hard-code as inputs/);
  });

  it('leaves out one agent alone, archived and example agents, stubs, and what a tool already does', () => {
    const tool = { id: 'stories', name: 'Stories', source: 'local', inputs: {}, outputs: {}, implementation: { type: 'shell', command: 'curl https://api.stories.test/v1/top' } } as ToolDefinition;
    expect(toolIdeasFromAgents([agent('a', [sh('f', FETCH(3)), sh('g', FETCH(5))])])).toEqual([]);
    expect(toolIdeasFromAgents([agent('a', [sh('f', FETCH(3))]), agent('b', [sh('f', FETCH(5))], { status: 'archived' })])).toEqual([]);
    expect(toolIdeasFromAgents([agent('a', [sh('f', FETCH(3))]), agent('b', [sh('f', FETCH(5))], { source: 'examples' })])).toEqual([]);
    expect(toolIdeasFromAgents([agent('a', [sh('f', FETCH(3))]), agent('b', [sh('f', FETCH(5))])], [tool])).toEqual([]);
    expect(toolIdeasFromAgents([agent('a', [sh('f', 'exit 1')]), agent('b', [sh('f', 'exit 1')])])).toEqual([]);
    expect(toolIdeasFromAgents([agent('a', [sh('f', 'echo \'{"ok": true, "items": []}\'')]), agent('b', [sh('f', 'echo \'{"ok": true, "items": []}\'')])])).toEqual([]);
  });

  it('keeps at most five, most shared first', () => {
    const agents: Agent[] = [];
    for (let h = 0; h < 7; h++) {
      for (let a = 0; a < 2 + (h === 6 ? 3 : 0); a++) agents.push(agent(`h${h}-a${a}`, [sh('f', `curl -s https://host${h}.example.test/api/thing | jq .x`)]));
    }
    const ideas = toolIdeasFromAgents(agents);
    expect(ideas).toHaveLength(5);
    expect(ideas[0].label).toBe('Fetch from host6.example.test');
  });
});

describe('toolIdeaFromStep', () => {
  it('turns a command or prompt step into a sentence, and nothing else', () => {
    const a = { id: 'news', name: 'News' };
    expect(toolIdeaFromStep(a, sh('fetch', FETCH(3)))).toMatch(/the "fetch" step of my agent "News"[\s\S]*curl -s/);
    expect(toolIdeaFromStep(a, { id: 'w', type: 'llm-prompt', prompt: 'Summarise {{upstream.fetch.result}}' })).toMatch(/Its prompt:/);
    expect(toolIdeaFromStep(a, { id: 't', type: 'shell', tool: 'http-get' })).toBeUndefined();
    expect(toolIdeaFromStep(a, { id: 'g', type: 'goal', goal: 'x' } as AgentNode)).toBeUndefined();
  });
});

describe('toolIdeasFromAgents — one idea per family of fetches', () => {
  it('leaves out a second address the same agents use, and URL parts as fields', () => {
    const cmd = (n: number) => `curl -s "https://api.stories.test/v1/top?limit=${n}" | jq '.[] | {title: .title, link: ("https://site.stories.test/item?id=" + .id)}'`;
    const ideas = toolIdeasFromAgents([
      agent('a', [sh('f', cmd(3))]), agent('b', [sh('f', cmd(5))]), agent('c', [sh('f', cmd(7))]), agent('d', [sh('f', cmd(9))]),
    ]);
    expect(ideas.map((i) => i.label)).toEqual(['Fetch from api.stories.test']);
    expect(ideas[0].text).not.toMatch(/\(.*stories.*\)/);
    expect(ideas[0].from).toBe('4 of your agents fetch this: “a”, “b”, “c” and 1 more.');
  });
});

describe('parseToolIdeas', () => {
  it('keeps up to four with a label and a sentence, without repeats', async () => {
    const { parseToolIdeas } = await import('./tool-ideas.js');
    const many = Array.from({ length: 6 }, (_, i) => ({ label: `Idea ${i}`, text: `Do thing ${i}`, why: 'because' }));
    expect(parseToolIdeas(`<ideas>${JSON.stringify(many)}</ideas>`)).toHaveLength(4);
    expect(parseToolIdeas('<ideas>[{"label": "", "text": "x"}]</ideas>')).toEqual([]);
    expect(parseToolIdeas('<ideas>not json</ideas>')).toEqual([]);
    expect(parseToolIdeas('<ideas>[{"label": "A", "text": "t", "why": "w"}]</ideas>')[0]).toMatchObject({ label: 'A', text: 't', from: 'w' });
  });
});

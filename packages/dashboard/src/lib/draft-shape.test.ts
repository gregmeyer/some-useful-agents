import { describe, it, expect } from 'vitest';
import { describeDraftShape } from './draft-shape.js';

describe('describeDraftShape', () => {
  it('a single goal node is a goal agent that can switch to a flow', () => {
    const s = describeDraftShape('id: g\nname: g\nnodes:\n  - id: research\n    type: goal\n    goal: find the best x\n    tools: [web-fetch, agent:price-checker]\n');
    expect(s).toMatchObject({ kind: 'goal', switchTo: 'flow', tools: ['web-fetch', 'agent:price-checker'], diagramHtml: '' });
    expect(s.label).toContain('works it out itself');
  });

  it('a chain of steps is a fixed flow with a diagram, and can switch to a goal agent', () => {
    const s = describeDraftShape([
      'id: f', 'name: f', 'nodes:',
      '  - id: fetch', '    type: shell', '    command: curl -s https://x',
      '  - id: sum', '    type: llm-prompt', '    prompt: summarise', '    dependsOn: [fetch]',
    ].join('\n'));
    expect(s).toMatchObject({ kind: 'flow', switchTo: 'goal' });
    expect(s.label).toBe('2-step flow: the same steps every run');
    expect(s.diagramHtml).toContain('<svg class="mini-dag"');
  });

  it('a flow with a goal step has no switch, and a broken draft says so', () => {
    const mixed = describeDraftShape('id: m\nname: m\nnodes:\n  - id: a\n    type: shell\n    command: echo\n  - id: b\n    type: goal\n    goal: g\n    tools: [web-fetch]\n    dependsOn: [a]\n');
    expect(mixed.switchTo).toBeUndefined();
    expect(mixed.label).toContain('with a goal step');
    const bad = describeDraftShape('nodes: [');
    expect(bad.kind).toBe('invalid');
    expect(bad.error).toBeTruthy();
  });
});

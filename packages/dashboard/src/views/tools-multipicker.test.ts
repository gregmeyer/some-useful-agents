import { describe, it, expect } from 'vitest';
import { policyDocumentSchema } from '@some-useful-agents/core';
import { render } from './html.js';
import { renderToolsMultipicker, parseToolsField, type PickableTool } from './tools-multipicker.js';

const tools: PickableTool[] = [
  { id: 'web-fetch', label: 'Fetch', description: 'Fetch a page. More words.', group: 'tools' },
  { id: 'shell-exec', label: 'Shell', description: 'Run a command.', group: 'tools' },
  { id: 'agent:helper', label: 'Helper', description: 'Looks things up.', group: 'agents' },
];

describe('renderToolsMultipicker', () => {
  it('lists selected tools first, keeps unknown selected ids, and shows policy blocks', () => {
    const policy = policyDocumentSchema.parse({ version: 1, defaultAction: 'allow', rules: [{ tool: 'shell-exec', effect: 'deny' }] });
    const out = render(renderToolsMultipicker({
      name: 'goalTools', tools, selected: ['shell-exec', 'gone-tool'], policy, agent: { id: 'a', source: 'local' }, idPrefix: 'goal',
    }));
    expect(out.indexOf('value="shell-exec"')).toBeLessThan(out.indexOf('value="web-fetch"'));
    expect(out).toMatch(/value="gone-tool" checked/);
    expect(out).toContain('Not installed here');
    expect(out).toContain('Blocked by policy rule #0');
    expect(out).toContain('2 selected');
    expect(out).toContain('Fetch a page.</span>');
    expect(out).not.toContain('More words');
  });

  it('parses checkbox arrays, single values and comma lists', () => {
    expect(parseToolsField(['a', 'b', 'a', ''])).toEqual(['a', 'b']);
    expect(parseToolsField('web-fetch')).toEqual(['web-fetch']);
    expect(parseToolsField('a, b  c')).toEqual(['a', 'b', 'c']);
    expect(parseToolsField(undefined)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suaComponentDocs, boardComponentDocs, type Run } from '@some-useful-agents/core';
import { renderRunView, renderSurfaceHost, runViewMessages, viewHistory } from './a2ui-surface.js';
import { actionToMessage } from './chat-turn.js';

const run = { id: 'r1', agentName: 'w', status: 'completed', startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T10:00:01Z', result: '{"temp":"21"}', triggeredBy: 'dashboard' } as Run;

describe('surface markup', () => {
  it('embeds the messages so nothing in a view can close the script tag', () => {
    const out = String(renderSurfaceHost('s1', [{ text: '</script><script>alert(1)</script>' }]));
    expect(out).toContain('data-a2ui-surface data-surface-id="s1"');
    expect(out).not.toContain('</script><script>');
    expect(out).toContain('\\u003c/script>');
  });

  it('draws a declared view, notes an invalid generated one, and skips agents without a view', () => {
    const declared = String(renderRunView({ id: 'w', view: { components: [{ id: 'root', component: 'Metric', label: 'Now', value: { path: '/outputs/temp' } }] } }, run, []));
    expect(declared).toContain('data-a2ui-surface');
    expect(declared).toContain('"temp":"21"');
    const bad = String(renderRunView({ id: 'w', view: { from: 'design' } }, run, [{ runId: 'r1', nodeId: 'design', status: 'completed', result: 'not a view' } as never]));
    expect(bad).toContain("couldn't be shown");
    expect(bad).not.toContain('not a view');
    expect(String(renderRunView({ id: 'w' }, run, []))).toBe('');
  });
});

describe('history, series and Run buttons in views', () => {
  const earlier = (id: string, at: string, stars: string) => ({ id, agentName: 'w', status: 'completed', startedAt: at, completedAt: at, result: `{"stars":"${stars}"}`, triggeredBy: 'cli' }) as Run;
  const runs = [earlier('r0', '2026-09-30T10:00:00Z', '1,200'), earlier('r-1', '2026-09-29T10:00:00Z', '1,100')];
  const store = {
    queryRuns: (f: { until?: string; limit?: number }) => ({ rows: runs.filter((r) => !f.until || r.startedAt < f.until), total: runs.length }),
    listNodeExecutions: () => [],
  };
  const now = { ...run, result: '{"stars":"1,300"}' } as Run;
  const trend = { components: [{ id: 'root', component: 'Sparkline', values: { path: '/series/stars' }, label: 'Stars' }] };

  it('reads earlier runs only when a declared view binds /history or /series', () => {
    expect(viewHistory({ id: 'w', view: trend }, now, store as never).map((h) => h.run.id)).toEqual(['r0', 'r-1']);
    expect(viewHistory({ id: 'w', view: { components: [{ id: 'root', component: 'Metric', label: 'x', value: { path: '/outputs/stars' } }] } }, now, store as never)).toEqual([]);
    expect(viewHistory({ id: 'w', view: { from: 'design' } }, now, store as never)).toHaveLength(2);
  });

  it('gives a Sparkline the series oldest first, ending with this run', () => {
    const out = runViewMessages({ id: 'w', view: trend }, now, [], 's', { runStore: store as never });
    const model = (out as { messages: Array<{ updateDataModel?: { value: { series: Record<string, number[]>; agent: { id: string } } } }> }).messages[2].updateDataModel!.value;
    expect(model.series.stars).toEqual([1100, 1200, 1300]);
    expect(model.agent).toEqual({ id: 'w' });
  });

  it('pins a Run button to the view\'s own agent, and marks the host with it', () => {
    const view = { components: [
      { id: 'root', component: 'Button', child: 'l', action: { event: { name: 'run-agent', context: { agent: 'someone-else', in_CITY: 'Lisbon' } } } },
      { id: 'l', component: 'Text', text: 'Run' },
    ] };
    const html = String(renderRunView({ id: 'w', view }, now, [], 's'));
    expect(html).toContain('data-view-agent="w"');
    expect(html).toContain('"context":{"agent":"w","in_CITY":"Lisbon"}');
    expect(html).not.toContain('someone-else');
  });
});

describe('widget actions as messages', () => {
  it('uses context.message, else "▸ name (k: v)", and refuses malformed actions', () => {
    expect(actionToMessage({ name: 'pick', context: { message: 'Show cheaper ones' } })).toEqual({ message: 'Show cheaper ones' });
    expect(actionToMessage({ name: 'run-again', context: { city: 'Lisbon', empty: '' } })).toEqual({ message: '▸ run-again (city: Lisbon)' });
    expect(actionToMessage({ name: '' })).toHaveProperty('error');
    expect(actionToMessage({ name: 'x', context: { blob: 'x'.repeat(5000) } })).toHaveProperty('error');
  });
});

describe('browser components match the core catalog', () => {
  it('defines exactly the sua components the server validates against', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const js = readFileSync(join(here, '..', 'assets', 'a2ui-sua.js'), 'utf8');
    const defined = [...js.matchAll(/define\('(\w+)'/g)].map((m) => m[1]).sort();
    expect(defined).toEqual([...suaComponentDocs(), ...boardComponentDocs()].map((d) => d.name).sort());
    // Board-only components are never offered to agent views.
    expect(suaComponentDocs().map((d) => d.name)).not.toContain('AgentTile');
  });
});

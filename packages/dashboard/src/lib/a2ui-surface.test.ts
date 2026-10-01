import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suaComponentDocs, type Run } from '@some-useful-agents/core';
import { renderRunView, renderSurfaceHost } from './a2ui-surface.js';
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
    expect(defined).toEqual(suaComponentDocs().map((d) => d.name).sort());
  });
});

import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { renderTile } from './pulse-renderers.js';
import type { PulseTile, TileWrapFn } from './pulse-types.js';
import { render } from './html.js';

const passThrough: TileWrapFn = (_tile, content) => content;

function tileFor(agent: Partial<Agent>, signalTemplate: string): PulseTile {
  return {
    agent: { id: 'demo', name: 'demo', inputs: {}, ...agent } as unknown as Agent,
    signal: { template: signalTemplate, mapping: {} } as PulseTile['signal'],
    slots: {},
  } as PulseTile;
}

describe('renderTile output-widget dispatch', () => {
  it('renders an interactive outputWidget as the tile even when signal.template is not "widget"', () => {
    // Mirrors the shipped mismatch (e.g. ashby-job-finder): interactive
    // outputWidget but signal.template === 'text-headline'. The interactive
    // widget must own the tile and show on first view (no run required).
    const tile = tileFor(
      { outputWidget: { type: 'ai-template', interactive: true } as Agent['outputWidget'] },
      'text-headline',
    );
    // A2UI (the default): the tile is a form + Run button surface.
    expect(render(renderTile(tile, passThrough))).toContain('data-a2ui-surface');
  });

  it('leaves a compact signal.template tile alone when the outputWidget is non-interactive', () => {
    // e.g. churn-watcher: signal.template: metric + a non-interactive
    // dashboard widget. The compact metric tile is intentional, so we must
    // NOT hijack it into the full widget.
    const tile = tileFor(
      { outputWidget: { type: 'dashboard' } as Agent['outputWidget'] },
      'metric',
    );
    const html = render(renderTile(tile, passThrough));
    expect(html).not.toContain('data-iw');
  });
});

describe("a tile drawn to be read (Today's edition)", () => {
  it("an interactive widget shows its last result without its input form; the footer runs it again with the same inputs", async () => {
    const { tileSurfaceMessages } = await import('./pulse-renderers.js');
    const { canvasTileEntry } = await import('../lib/board-canvas.js');
    const at = '2026-11-22T00:00:00.000Z';
    const agent = {
      id: 'weather', name: 'Weather', status: 'active', source: 'local', mcp: false, nodes: [],
      inputs: { LOCATION: { type: 'string', required: true, description: 'City name' } },
      outputWidget: { type: 'dashboard', interactive: true, fields: [{ name: 'temp', type: 'text', label: 'Temperature' }] },
    } as unknown as Agent;
    const base: PulseTile = {
      agent, signal: { title: 'Weather', template: 'widget' }, slots: {}, previousInputs: { LOCATION: '98225' },
      lastRun: { id: 'r1', agentName: 'weather', status: 'completed', startedAt: at, completedAt: at, result: JSON.stringify({ temp: '52F' }), triggeredBy: 'schedule' } as never,
    };
    const used = JSON.stringify(tileSurfaceMessages(base));
    expect(used).toContain('TextField');
    expect(canvasTileEntry(base, { isPulse: false }).run).toBe('none');
    const read = JSON.stringify(tileSurfaceMessages({ ...base, readOnly: true }));
    expect(read).not.toContain('TextField');
    expect(read).not.toContain('run-agent');
    expect(canvasTileEntry({ ...base, readOnly: true }, { isPulse: false })).toMatchObject({ run: 'button', runBody: 'again=1', changeHref: '/agents/weather' });
  });
});

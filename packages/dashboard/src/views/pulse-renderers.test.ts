import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { renderTile } from './pulse-renderers.js';
import type { PulseTile, TileWrapFn } from './pulse-types.js';
import { render } from './html.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setDashboardPrefs, setDashboardPrefsDir } from '../lib/dashboard-prefs.js';

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
    // The previous renderer (kept one release as a fallback): the interactive widget shell.
    setDashboardPrefsDir(mkdtempSync(join(tmpdir(), 'sua-prefs-')));
    setDashboardPrefs({ a2uiWidgets: false });
    try {
      expect(render(renderTile(tile, passThrough))).toContain('data-iw');
    } finally { setDashboardPrefs({ a2uiWidgets: true }); }
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

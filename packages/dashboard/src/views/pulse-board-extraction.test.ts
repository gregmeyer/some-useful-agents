/**
 * `renderPulseBoard` is the reusable board content the unified home (`/`)
 * embeds — system + agent tiles, the dashboards dropdown, and the JSON the
 * client JS reads. These guard its option gating so `/` and `/dashboards/:id`
 * compose it consistently.
 */
import { describe, it, expect } from 'vitest';
import { renderPulseBoard } from './pulse.js';
import { html } from './html.js';
import type { PulsePageInput } from './pulse-types.js';

const EMPTY: PulsePageInput = { systemTiles: [], tiles: [], hiddenTiles: [] };

describe('renderPulseBoard', () => {
  it('is board content only — no layout wrapper — and carries the pulse JSON', () => {
    const board = renderPulseBoard(EMPTY).toString();
    expect(board).toContain('id="pulse-tile-data"');
    expect(board).toContain('id="pulse-template-registry"');
    expect(board).toContain('pulse-grid');
    // No page chrome — the caller wraps it in layout().
    expect(board).not.toContain('<!DOCTYPE html>');
  });

  it('the default board is editable (Edit layout present); editable:false hides it', () => {
    const editable = renderPulseBoard(EMPTY).toString();
    const readOnly = renderPulseBoard(EMPTY, { editable: false }).toString();
    expect(editable).toContain('id="pulse-edit-toggle"');
    expect(readOnly).not.toContain('id="pulse-edit-toggle"');
    // The tile grid is present in both.
    expect(editable).toContain('pulse-grid');
    expect(readOnly).toContain('pulse-grid');
  });

  it('a custom heading replaces the default <h1>Pulse</h1>', () => {
    const custom = renderPulseBoard(EMPTY, { heading: html`<h2>Live Pulse</h2>` }).toString();
    expect(custom).toContain('<h2>Live Pulse</h2>');
    expect(custom).not.toContain('<h1 style="margin: 0;">Pulse</h1>');
  });
});

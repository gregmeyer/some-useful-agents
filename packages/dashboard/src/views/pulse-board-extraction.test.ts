/**
 * Regression: `renderPulseBoard` (the reusable board content the Mission
 * Control home embeds) must be exactly what `/pulse` renders inside its layout,
 * so the two surfaces never diverge. Also checks the `editable: false` variant
 * (used on `/`) drops the board-level edit affordances but keeps the tiles.
 */
import { describe, it, expect } from 'vitest';
import { renderPulseBoard, renderPulsePage } from './pulse.js';
import { html } from './html.js';
import type { PulsePageInput } from './pulse-types.js';

const EMPTY: PulsePageInput = { systemTiles: [], tiles: [], hiddenTiles: [] };

describe('renderPulseBoard vs renderPulsePage', () => {
  it('the page is just the board wrapped in the layout (board content is contained verbatim)', () => {
    const board = renderPulseBoard(EMPTY).toString();
    const page = renderPulsePage(EMPTY);
    // The page must contain the entire board markup.
    expect(page).toContain(board);
    // Both carry the pulse JSON the client JS reads.
    expect(board).toContain('id="pulse-tile-data"');
    expect(page).toContain('id="pulse-template-registry"');
    // The page adds the layout chrome the board lacks.
    expect(board).not.toContain('<!DOCTYPE html>');
    expect(page).toContain('<!DOCTYPE html>');
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

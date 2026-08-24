/**
 * `renderPulseBoard` is the reusable board content the unified home (`/`)
 * embeds — system + agent tiles, the dashboards dropdown, and the JSON the
 * client JS reads. These guard its option gating so `/` and `/dashboards/:id`
 * compose it consistently.
 */
import { describe, it, expect } from 'vitest';
import { renderPulseBoard, PULSE_LAYOUT_VERSION } from './pulse.js';
import { html } from './html.js';
import type { PulsePageInput } from './pulse-types.js';

const EMPTY: PulsePageInput = { systemTiles: [], tiles: [], hiddenTiles: [] };

describe('renderPulseBoard', () => {
  it('is board content only — no layout wrapper — and carries the pulse JSON', () => {
    const board = renderPulseBoard(EMPTY).toString();
    expect(board).toContain('id="pulse-tile-data"');
    expect(board).toContain('id="pulse-template-registry"');
    // An empty board now explains itself instead of rendering a bare grid.
    expect(board).toContain('pulse-empty');
    // No page chrome — the caller wraps it in layout().
    expect(board).not.toContain('<!DOCTYPE html>');
  });

  it('the default board is editable (Edit layout present); editable:false hides it', () => {
    const editable = renderPulseBoard(EMPTY).toString();
    const readOnly = renderPulseBoard(EMPTY, { editable: false }).toString();
    expect(editable).toContain('id="pulse-edit-toggle"');
    expect(readOnly).not.toContain('id="pulse-edit-toggle"');
    // The container host is present in both.
    expect(editable).toContain('id="pulse-containers"');
    expect(readOnly).toContain('id="pulse-containers"');
  });

  it('a custom heading replaces the default <h1>Pulse</h1>', () => {
    const custom = renderPulseBoard(EMPTY, { heading: html`<h2>Live Pulse</h2>` }).toString();
    expect(custom).toContain('<h2>Live Pulse</h2>');
    expect(custom).not.toContain('<h1 style="margin: 0;">Pulse</h1>');
  });
});

/**
 * The board renders one labelled section per group, in order. This is what a
 * no-JS reader and the first paint actually see — the client layout engine
 * re-renders from localStorage afterwards, seeded from the same groups.
 */
describe('renderPulseBoard grouping', () => {
  const at = (iso: string) => ({ id: 'r', agentName: 'a', status: 'completed', completedAt: iso, startedAt: iso });
  const mkTile = (id: string, completedAt?: string) => ({
    agent: { id, name: id, status: 'active', source: 'local', version: 1, nodes: [] },
    signal: { title: id, template: 'metric' },
    slots: {},
    lastRun: completedAt ? at(completedAt) : undefined,
  }) as unknown as PulsePageInput['tiles'][number];

  it('emits a labelled section per non-empty group, most actionable first', () => {
    const now = new Date().toISOString();
    const board = renderPulseBoard({
      systemTiles: [],
      tiles: [mkTile('fresh', now), mkTile('unused')],
      hiddenTiles: [],
    }).toString();
    expect(board).toContain('data-container-id="recent"');
    expect(board).toContain('data-container-id="never-run"');
    expect(board.indexOf('data-container-id="recent"'))
      .toBeLessThan(board.indexOf('data-container-id="never-run"'));
    expect(board).toContain('>Recent<');
    expect(board).toContain('>Never run<');
    // The old single flat grid is gone.
    expect(board).not.toContain('data-container-id="_default"');
  });

  it('publishes the groups and a layout version for the client to seed from', () => {
    // Without these the client keeps whatever grouping it had in
    // localStorage and the new ordering is invisible to anyone who has
    // loaded Pulse before.
    const board = renderPulseBoard({
      systemTiles: [],
      tiles: [mkTile('a', new Date().toISOString())],
      hiddenTiles: [],
    }).toString();
    const json = JSON.parse(
      /id="pulse-tile-data">(.*?)<\/script>/s.exec(board)![1],
    );
    expect(json.layoutVersion).toBe(PULSE_LAYOUT_VERSION);
    expect(json.groups.map((g: { label: string }) => g.label)).toEqual(['Recent']);
    expect(json.groups[0].tiles).toEqual(['a']);
  });

  it('renders nothing but the shell when there are no tiles at all', () => {
    const board = renderPulseBoard(EMPTY).toString();
    expect(board).toContain('id="pulse-containers"');
    expect(board).not.toContain('pulse-container__label');
    expect(board).toContain('Nothing on the board yet');
  });
});

/**
 * Every Pulse tile must be runnable from the board.
 *
 * Pulse is used as a run console — on a real install 83% of runs came from a
 * dashboard click — but only tiles backed by an `outputWidget` rendered a run
 * control, because only those embed the widget's replay control. Every
 * `metric` / `status` / `text-headline` tile was a read-only rectangle, and a
 * tile whose agent had never run was a dead one.
 *
 * The control deliberately reuses the widget replay markup
 * (`form.wc-group--replay` + `[data-widget-control="replay"]`) because the
 * shipped in-place handler in `widget-replay.js.ts` binds to exactly that
 * selector inside `.pulse-tile[data-agent-id]`. These tests pin the contract
 * on both sides — if either the class or the nesting drifts, running from a
 * tile silently reverts to a full-page navigation, which is the kind of
 * regression nobody notices until they are annoyed by it.
 */

import { describe, it, expect } from 'vitest';
import type { Agent, AgentSignal, Run } from '@some-useful-agents/core';
import { tileWrap } from './pulse.js';
import { html } from './html.js';
import { WIDGET_REPLAY_INPLACE_JS } from './widget-replay.js.js';
import type { PulseTile } from './pulse-types.js';

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'demo', name: 'Demo', status: 'active', source: 'local', version: 1,
    nodes: [{ id: 'n1', type: 'shell', command: 'echo hi' }],
    ...over,
  } as Agent;
}

function completedRun(): Run {
  return {
    id: 'run-1', agentName: 'demo', status: 'completed', result: '{"v":1}',
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
  } as Run;
}

function tile(over: Partial<PulseTile> = {}): PulseTile {
  return {
    agent: agent(),
    signal: { title: 'Demo', template: 'metric' } as AgentSignal,
    slots: {},
    lastRun: undefined,
    ...over,
  } as PulseTile;
}

const body = html`<p>body</p>`;
/** The footer is the last chunk of the tile; body controls live before it. */
function footerOf(markup: string): string {
  const i = markup.indexOf('pulse-tile__footer');
  return i < 0 ? '' : markup.slice(i);
}

describe('tile run control', () => {
  it('gives a plain metric tile a way to run — it had none', () => {
    const out = tileWrap(tile(), body).toString();
    expect(footerOf(out)).toContain('wc-group--replay');
    expect(footerOf(out)).toContain('data-widget-control="replay"');
  });

  it('gives a tile that has never run one too — the case that matters most', () => {
    // A never-run tile renders "No data yet" and was previously a dead
    // rectangle; for a launcher it is the most actionable thing on the board.
    const out = tileWrap(tile({ lastRun: undefined }), body).toString();
    expect(footerOf(out)).toContain('wc-group--replay');
    expect(footerOf(out)).toContain('never');
  });

  it('posts somewhere useful without JS', () => {
    // Progressive enhancement is the existing contract: no JS ⇒ the form
    // POSTs and navigates to the run.
    const out = tileWrap(tile(), body).toString();
    expect(out).toContain('action="/agents/demo/run"');
    expect(out).toContain('method="POST"');
  });

  it('never puts one on a system tile', () => {
    // System tiles are synthetic aggregates with no agent to run.
    const sys = tile({ agent: agent({ id: '_system-runs-today' }) });
    const out = tileWrap(sys, body).toString();
    expect(out).not.toContain('wc-group--replay');
    expect(out).not.toContain('pulse-tile__run-link');
  });

  it('does not double up on an interactive widget tile', () => {
    const t = tile({
      agent: agent({ outputWidget: { type: 'raw', interactive: true } as never }),
    });
    expect(footerOf(tileWrap(t, body).toString())).not.toContain('wc-group--replay');
  });

  it('does not double up on a widget tile that already shows Run again', () => {
    const t = tile({
      signal: { title: 'W', template: 'widget' } as AgentSignal,
      agent: agent({ outputWidget: { type: 'raw' } as never }),
      lastRun: completedRun(),
    });
    expect(footerOf(tileWrap(t, body).toString())).not.toContain('wc-group--replay');
  });

  it('DOES add one to a widget tile with no output yet', () => {
    // `template: widget` with no prior run renders "No widget output yet."
    // and no control — exactly a tile that needs ours.
    const t = tile({
      signal: { title: 'W', template: 'widget' } as AgentSignal,
      agent: agent({ outputWidget: { type: 'raw' } as never }),
      lastRun: undefined,
    });
    expect(footerOf(tileWrap(t, body).toString())).toContain('wc-group--replay');
  });

  it('sends you to the agent page when a required input has no default', () => {
    // A one-click run would fail every time; for an operator a red tile is
    // worse than a click.
    const t = tile({
      agent: agent({ inputs: { TOPIC: { type: 'string', required: true } } }),
    });
    const foot = footerOf(tileWrap(t, body).toString());
    expect(foot).toContain('pulse-tile__run-link');
    expect(foot).toContain('href="/agents/demo"');
    expect(foot).not.toContain('wc-group--replay');
  });

  it('still runs in one click when every required input has a default', () => {
    const t = tile({
      agent: agent({ inputs: { TOPIC: { type: 'string', required: true, default: 'cats' } } }),
    });
    const foot = footerOf(tileWrap(t, body).toString());
    expect(foot).toContain('wc-group--replay');
    expect(foot).not.toContain('pulse-tile__run-link');
  });

  it('keeps the form inside the tile the in-place handler looks for', () => {
    // The handler does form.closest('.pulse-tile[data-agent-id]') and reads
    // the agent id off it. Nesting is load-bearing, not cosmetic.
    const out = tileWrap(tile(), body).toString();
    const tileAt = out.indexOf('class="pulse-tile ');
    const formAt = out.indexOf('wc-group--replay');
    expect(tileAt).toBeGreaterThanOrEqual(0);
    expect(formAt).toBeGreaterThan(tileAt);
    expect(out).toContain('data-agent-id="demo"');
  });

  it('matches the selector the shipped handler actually binds to', () => {
    // Read from the shipped client source rather than restating it, so a
    // rename on either side fails here instead of in a browser.
    expect(WIDGET_REPLAY_INPLACE_JS).toContain("form.wc-group--replay");
    expect(WIDGET_REPLAY_INPLACE_JS).toContain(".pulse-tile[data-agent-id]");
  });
});

/**
 * Tile sizing honours the template's own default.
 *
 * `TEMPLATE_REGISTRY` declares a `defaultSize` per template and
 * `discovery-catalog.ts` reports it to the build planner, but the renderer
 * hardcoded `signal.size ?? '1x1'` — so the registry's sizes were dead config
 * and a `widget` or `table` tile with no explicit size was squeezed into a box
 * the registry says should be twice as wide.
 */
describe('tile sizing', () => {
  const sized = (signal: Partial<AgentSignal>) =>
    tileWrap(tile({ signal: { title: 'T', ...signal } as AgentSignal }), body).toString();

  it('uses the template default when the agent declares no size', () => {
    // widget/table/story/key-value/comparison/media/text-image are all 2x1.
    expect(sized({ template: 'widget' })).toContain('data-tile-size="2x1"');
    expect(sized({ template: 'table' })).toContain('data-tile-size="2x1"');
    expect(sized({ template: 'image' })).toContain('data-tile-size="2x2"');
    expect(sized({ template: 'funnel' })).toContain('data-tile-size="1x2"');
  });

  it('leaves genuinely small templates small', () => {
    for (const t of ['metric', 'status', 'text-headline'] as const) {
      expect(sized({ template: t })).toContain('data-tile-size="1x1"');
    }
  });

  it('an explicit signal.size still wins over the template default', () => {
    expect(sized({ template: 'widget', size: '1x1' })).toContain('data-tile-size="1x1"');
  });

  it('a layout hint still wins over everything', () => {
    const t = tile({
      signal: { title: 'T', template: 'metric' } as AgentSignal,
      layoutHint: { agentId: 'demo', size: '2x2', updatedAt: 0 },
    } as Partial<PulseTile>);
    expect(tileWrap(t, body).toString()).toContain('data-tile-size="2x2"');
  });

  it('reports the effective size to the configure modal, not a stale 1x1', () => {
    // The modal writes back whatever it shows; reporting 1x1 for a tile the
    // template is sizing 2x1 would silently shrink it on the next save.
    const out = sized({ template: 'widget' });
    const cfg = /data-signal-config="([^"]*)"/.exec(out)![1].replace(/&quot;/g, '"');
    expect(JSON.parse(cfg).size).toBe('2x1');
  });
});

/**
 * Targeted tests for tileWrap's layout-hint fallback chain. The hint
 * layer is wired in PR 1 but not yet written to by any commit path —
 * these tests pin the lookup behaviour so PR 2 (writes) and PR 3
 * (dashboard placements) can land without regressing it.
 */

import { describe, it, expect } from 'vitest';
import type { Agent, AgentSignal, LayoutHint } from '@some-useful-agents/core';
import { html } from './html.js';
import { tileWrap } from './pulse.js';
import type { PulseTile } from './pulse-types.js';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'demo',
    name: 'Demo',
    status: 'active',
    nodes: [],
    edges: [],
    inputs: {},
    ...overrides,
  } as Agent;
}

function makeTile(opts: {
  signalSize?: AgentSignal['size'];
  widgetTileFit?: 'grow' | 'scroll';
  hint?: LayoutHint;
}): PulseTile {
  const signal: AgentSignal = {
    title: 'Demo signal',
    template: 'text-headline',
    size: opts.signalSize,
  } as AgentSignal;
  const agent = makeAgent({
    signal,
    outputWidget: opts.widgetTileFit
      ? ({ kind: 'text', tileFit: opts.widgetTileFit } as unknown as Agent['outputWidget'])
      : undefined,
  });
  return {
    agent,
    signal,
    slots: { value: 'hello' },
    layoutHint: opts.hint,
  };
}

const content = html`<p>body</p>`;

describe('tileWrap layout-hint fallback', () => {
  it('uses layoutHint.size when present', () => {
    const out = tileWrap(makeTile({ signalSize: '1x1', hint: { agentId: 'demo', size: '2x2', updatedAt: 1 } }), content);
    const s = out.toString();
    expect(s).toMatch(/data-tile-size="2x2"/);
    expect(s).toMatch(/pulse-tile--2x2/);
  });

  it('falls back to signal.size when no hint is set', () => {
    const out = tileWrap(makeTile({ signalSize: '2x1' }), content);
    const s = out.toString();
    expect(s).toMatch(/data-tile-size="2x1"/);
  });

  it('falls back to 1x1 when neither hint nor signal sets a size', () => {
    const out = tileWrap(makeTile({}), content);
    const s = out.toString();
    expect(s).toMatch(/data-tile-size="1x1"/);
  });

  it('uses layoutHint.tileFit over the agent widget default', () => {
    const out = tileWrap(makeTile({
      widgetTileFit: 'grow',
      hint: { agentId: 'demo', tileFit: 'scroll', updatedAt: 1 },
    }), content);
    expect(out.toString()).toMatch(/pulse-tile--fit-scroll/);
  });

  it('falls back to outputWidget.tileFit when no hint is set', () => {
    const out = tileWrap(makeTile({ widgetTileFit: 'scroll' }), content);
    expect(out.toString()).toMatch(/pulse-tile--fit-scroll/);
  });

  it('omits the fit class entirely when the agent has no outputWidget and no hint', () => {
    const out = tileWrap(makeTile({}), content);
    expect(out.toString()).not.toMatch(/pulse-tile--fit-/);
  });

  it('applies layoutHint.height as an inline style', () => {
    const out = tileWrap(makeTile({ hint: { agentId: 'demo', height: 240, updatedAt: 1 } }), content);
    expect(out.toString()).toMatch(/style="height: 240px"/);
  });

  it('omits the inline height when no hint height is set', () => {
    const out = tileWrap(makeTile({ signalSize: '2x1' }), content);
    expect(out.toString()).not.toMatch(/style="height:/);
  });
});

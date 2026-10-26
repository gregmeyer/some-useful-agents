/**
 * A canvas tile's run control and size (Pulse and dashboards draw every
 * tile this way): a tile you can't run from is a dead rectangle, so every
 * agent tile gets one, unless its body already offers Run (an interactive
 * widget, or a widget that shows Run again), or it can't run as it is.
 */
import { describe, it, expect } from 'vitest';
import type { Agent, AgentSignal, Run } from '@some-useful-agents/core';
import { canvasTileEntry } from './board-canvas.js';
import type { PulseTile } from '../views/pulse-types.js';

function agent(over: Partial<Agent> = {}): Agent {
  return { id: 'demo', name: 'Demo', status: 'active', source: 'local', version: 1, nodes: [{ id: 'n1', type: 'shell', command: 'echo hi' }], ...over } as Agent;
}
const completedRun = (): Run => ({ id: 'run-1', agentName: 'demo', status: 'completed', result: '{"v":1}', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }) as Run;
function tile(over: Partial<PulseTile> = {}): PulseTile {
  return { agent: agent(), signal: { title: 'Demo', template: 'metric' } as AgentSignal, slots: {}, lastRun: undefined, ...over } as PulseTile;
}
const entry = (t: PulseTile) => canvasTileEntry(t, { isPulse: true });
const widget = { type: 'raw', fields: [{ name: 'result', type: 'text' }] } as unknown as Agent['outputWidget'];

describe('a canvas tile\'s run control', () => {
  it('gives a plain tile a Run button, ran or never run', () => {
    expect(entry(tile()).run).toBe('button');
    expect(entry(tile({ lastRun: completedRun() })).run).toBe('button');
  });

  it('never puts one on a system tile or an archived agent', () => {
    expect(entry(tile({ agent: agent({ id: '_system-scheduler' }) })).run).toBe('none');
    expect(entry(tile({ agent: agent({ status: 'archived' }) })).run).toBe('none');
  });

  it('does not double up on a widget that runs itself or shows Run again', () => {
    expect(entry(tile({ agent: agent({ outputWidget: { ...widget, interactive: true } as Agent['outputWidget'] }) })).run).toBe('none');
    expect(entry(tile({ agent: agent({ outputWidget: widget }), signal: { title: 'W', template: 'widget' } as AgentSignal, lastRun: completedRun() })).run).toBe('none');
  });

  it('DOES add one to a widget tile with no output yet', () => {
    expect(entry(tile({ agent: agent({ outputWidget: widget }), signal: { title: 'W', template: 'widget' } as AgentSignal })).run).toBe('button');
  });

  it('sends you to the agent page when a required input has no default; runs in one click when every one has a default', () => {
    expect(entry(tile({ agent: agent({ inputs: { CITY: { type: 'string', required: true } } } as Partial<Agent>) })).run).toBe('link');
    expect(entry(tile({ agent: agent({ inputs: { CITY: { type: 'string', required: true, default: 'Paris' } } } as Partial<Agent>) })).run).toBe('button');
  });
});

describe('a canvas tile\'s size', () => {
  it('uses the template default when the agent declares none, and its own when it does', () => {
    const sized = (t: PulseTile) => (entry(t) as { configure?: { config?: { size?: string } } }).configure?.config?.size;
    expect(sized(tile({ signal: { title: 'T', template: 'table' } as AgentSignal }))).toBe('2x1');
    expect(sized(tile({ signal: { title: 'M', template: 'metric' } as AgentSignal }))).toBe('1x1');
    expect(sized(tile({ signal: { title: 'T', template: 'table', size: '1x1' } as AgentSignal }))).toBe('1x1');
  });
});

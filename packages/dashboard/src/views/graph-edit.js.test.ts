/**
 * The wiring editor, executed as the string we actually ship.
 *
 * Same approach as session-guard.test.ts: there is no DOM in this suite, so we
 * stub the handful of globals the script touches and run the real source
 * through `new Function`. Re-implementing the logic here would prove nothing
 * about the string that reaches the browser, and this also catches a syntax
 * error in the template — which would otherwise surface only as a silently
 * dead editor.
 *
 * What this cannot cover is the physical gesture: whether dragging across a
 * <canvas> makes cytoscape emit `mouseup` on the node under the cursor. That is
 * cytoscape's contract, not ours. Everything downstream of the event — which
 * edges get added, which are refused, what lands in the hidden input — is here.
 */

import { describe, it, expect } from 'vitest';
import { GRAPH_EDIT_JS } from './graph-edit.js.js';

interface FakeEl {
  hidden?: boolean;
  disabled?: boolean;
  value?: string;
  textContent?: string;
  attrs: Record<string, string>;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  closest?: (sel: string) => FakeEl | null;
}

interface Harness {
  /** Click a toolbar button by its data-dag-edit value. */
  click: (action: string) => void;
  /** Press on one node and release on another — the drag gesture. */
  drag: (from: string, to: string) => void;
  /** Tap a node (the keyboard/touch-friendly click-click path). */
  tapNode: (id: string) => void;
  /** Tap an edge, which removes it in edit mode. */
  tapEdge: (source: string, target: string) => void;
  /** Current edges as "source->target", sorted. */
  edges: () => string[];
  /** The JSON the form would post. */
  posted: () => Record<string, string[]>;
  submit: () => void;
  saveDisabled: () => boolean;
  hintText: () => string;
  editing: () => boolean;
  renderCalls: () => number;
  dagSig: () => unknown;
}

/**
 * Build the stub world. Only what the script actually reaches for is provided;
 * anything else would throw and fail the test, which is what we want.
 */
function run(nodeIds: string[], edgePairs: Array<[string, string]>): Harness {
  const nodes = [...nodeIds];
  let edges = edgePairs.map(([source, target]) => ({ source, target }));

  const mkEl = (): FakeEl => {
    const el: FakeEl = {
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k] ?? null; },
    };
    return el;
  };

  const form = mkEl();
  const hint = mkEl();
  const input = mkEl();
  const toggle = mkEl();
  const saveBtn = mkEl();
  saveBtn.disabled = true;

  let classOn = false;
  const canvas: Record<string, unknown> = {
    classList: { toggle: (_n: string, on: boolean) => { classOn = on; } },
  };

  // Element handles handed to the cytoscape event handlers.
  const nodeHandle = (id: string) => ({
    id: () => id,
    style: () => undefined,
    removeStyle: () => undefined,
  });
  const edgeHandle = (e: { source: string; target: string }) => ({
    id: () => `${e.source}->${e.target}`,
    source: () => nodeHandle(e.source),
    target: () => nodeHandle(e.target),
    remove: () => { edges = edges.filter((x) => x !== e); },
  });

  // `[key = "value"]` pairs, ANDed — the only selector shape the script uses.
  const matches = (sel: string, e: { source: string; target: string }): boolean => {
    const pairs = [...sel.matchAll(/\[(\w+)\s*=\s*"([^"]*)"\]/g)];
    return pairs.every(([, k, v]) => (e as unknown as Record<string, string>)[k] === v);
  };

  const handlers: Array<{ events: string; selector?: string; fn: (evt: unknown) => void }> = [];

  const cy = {
    nodes: () => nodes.map(nodeHandle),
    // A plain array already satisfies the `.forEach` / `.length` / index
    // access the script uses on a cytoscape collection.
    edges: (sel?: string) => (sel ? edges.filter((e) => matches(sel, e)) : edges).map(edgeHandle),
    add: (spec: { data: { source: string; target: string } }) => {
      edges.push({ source: spec.data.source, target: spec.data.target });
    },
    getElementById: (id: string) => nodeHandle(id),
    on: (events: string, a: unknown, b?: unknown) => {
      if (typeof a === 'string') handlers.push({ events, selector: a, fn: b as (e: unknown) => void });
      else handlers.push({ events, fn: a as (e: unknown) => void });
    },
  };
  canvas.__cy = cy;

  let toolbarClick: ((evt: unknown) => void) | undefined;
  let formSubmit: (() => void) | undefined;

  const toolbar = {
    querySelector: (sel: string) => {
      if (sel === '[data-dag-edit-form]') return form;
      if (sel === '[data-dag-edit-hint]') return hint;
      if (sel === '[data-dag-edit-wiring]') return input;
      if (sel === '[data-dag-edit="toggle"]') return toggle;
      if (sel === '[data-dag-edit="save"]') return saveBtn;
      return null;
    },
    addEventListener: (type: string, fn: (evt: unknown) => void) => {
      if (type === 'click') toolbarClick = fn;
    },
  };
  (form as unknown as { addEventListener: (t: string, f: () => void) => void }).addEventListener =
    (type, fn) => { if (type === 'submit') formSubmit = fn; };

  const doc = {
    getElementById: (id: string) => (id === 'dag-canvas' ? canvas : null),
    querySelector: (sel: string) => (sel === '[data-dag-edit-toolbar]' ? toolbar : null),
  };

  let renderCalls = 0;
  const win: Record<string, unknown> = { renderDagViz: () => { renderCalls += 1; } };

  // Timers: run the flash-restore callback never (tests read the message that
  // was just set), but keep the API present so the script does not throw.
  const setTimeoutStub = (): number => 1;
  const clearTimeoutStub = (): void => undefined;

  new Function('document', 'window', 'setTimeout', 'clearTimeout', GRAPH_EDIT_JS)(
    doc, win, setTimeoutStub, clearTimeoutStub,
  );

  const fire = (events: string, selector: string | undefined, evt: unknown): void => {
    for (const h of handlers) {
      if (h.selector !== selector) continue;
      if (!h.events.split(' ').includes(events)) continue;
      h.fn(evt);
    }
  };

  return {
    click(action) {
      const btn = mkEl();
      btn.setAttribute('data-dag-edit', action);
      btn.closest = () => btn;
      toolbarClick?.({ target: btn });
    },
    drag(from, to) {
      fire('mousedown', 'node', { target: nodeHandle(from) });
      fire('mouseup', 'node', { target: nodeHandle(to) });
    },
    tapNode(id) { fire('tap', 'node', { target: nodeHandle(id) }); },
    tapEdge(source, target) {
      const e = edges.find((x) => x.source === source && x.target === target);
      if (!e) throw new Error(`no edge ${source}->${target}`);
      fire('tap', 'edge', { target: edgeHandle(e) });
    },
    edges: () => edges.map((e) => `${e.source}->${e.target}`).sort(),
    posted: () => JSON.parse(input.value || '{}'),
    submit: () => formSubmit?.(),
    saveDisabled: () => saveBtn.disabled !== false,
    hintText: () => hint.textContent ?? '',
    editing: () => classOn,
    renderCalls: () => renderCalls,
    dagSig: () => canvas.__dagSig,
  };
}

describe('graph-edit.js — the shipped wiring editor', () => {
  it('does nothing until edit mode is on', () => {
    const h = run(['a', 'b'], []);
    h.drag('a', 'b');
    expect(h.edges()).toEqual([]);
    expect(h.editing()).toBe(false);
  });

  it('connects two nodes on drag, in the direction the DAG draws', () => {
    const h = run(['a', 'b'], []);
    h.click('toggle');
    h.drag('a', 'b');
    // source→target means "target dependsOn source".
    expect(h.edges()).toEqual(['a->b']);
    expect(h.posted()).toEqual({ a: [], b: ['a'] });
  });

  it('connects by tapping source then target, for keyboard and touch', () => {
    const h = run(['a', 'b'], []);
    h.click('toggle');
    h.tapNode('a');
    expect(h.hintText()).toContain('should depend on a');
    h.tapNode('b');
    expect(h.edges()).toEqual(['a->b']);
  });

  it('treats a drag or tap that starts and ends on one node as a no-op, silently', () => {
    const h = run(['a'], []);
    h.click('toggle');
    h.drag('a', 'a');
    expect(h.edges()).toEqual([]);
    // Both gestures drop a self-pair before reaching connect(), so nothing is
    // attempted and there is nothing to complain about — releasing where you
    // pressed should not produce an error message.
    expect(h.hintText()).toBe('');
    expect(h.saveDisabled()).toBe(true);
  });

  it('refuses a duplicate edge and says so', () => {
    const h = run(['a', 'b'], [['a', 'b']]);
    h.click('toggle');
    h.drag('a', 'b');
    expect(h.edges()).toEqual(['a->b']);
    expect(h.hintText()).toContain('already depends on');
  });

  // The client-side cycle check is the only real logic here that a server
  // round-trip would not already cover, and it is what keeps the canvas from
  // showing a graph the server will reject.
  it('refuses an edge that would close a loop, directly or through a chain', () => {
    const direct = run(['a', 'b'], [['a', 'b']]);
    direct.click('toggle');
    direct.drag('b', 'a');
    expect(direct.edges()).toEqual(['a->b']);
    expect(direct.hintText()).toContain('loop');

    const chain = run(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    chain.click('toggle');
    chain.drag('c', 'a');
    expect(chain.edges()).toEqual(['a->b', 'b->c']);
  });

  it('removes an edge when it is tapped', () => {
    const h = run(['a', 'b'], [['a', 'b']]);
    h.click('toggle');
    h.tapEdge('a', 'b');
    expect(h.edges()).toEqual([]);
    expect(h.posted()).toEqual({ a: [], b: [] });
  });

  it('enables Save only once the wiring actually differs', () => {
    const h = run(['a', 'b'], [['a', 'b']]);
    h.click('toggle');
    expect(h.saveDisabled()).toBe(true);
    h.tapEdge('a', 'b');
    expect(h.saveDisabled()).toBe(false);
    // Re-adding the same edge returns to the original wiring.
    h.drag('a', 'b');
    expect(h.saveDisabled()).toBe(true);
  });

  it('posts the full wiring map, not a diff', () => {
    const h = run(['a', 'b', 'c'], [['a', 'b']]);
    h.click('toggle');
    h.drag('b', 'c');
    h.submit();
    expect(h.posted()).toEqual({ a: [], b: ['a'], c: ['b'] });
  });

  it('cancel clears the render signature so the canvas rebuilds from the server payload', () => {
    const h = run(['a', 'b'], [['a', 'b']]);
    h.click('toggle');
    h.tapEdge('a', 'b');
    h.click('cancel');
    // The local edge list is not restored by the script — it re-renders from
    // #dag-data, which only happens because the signature was cleared.
    expect(h.dagSig()).toBeNull();
    expect(h.renderCalls()).toBe(1);
    expect(h.editing()).toBe(false);
  });

  it('toggles edit mode on and off', () => {
    const h = run(['a', 'b'], []);
    h.click('toggle');
    expect(h.editing()).toBe(true);
    h.click('toggle');
    expect(h.editing()).toBe(false);
    // Out of edit mode, gestures are inert again.
    h.drag('a', 'b');
    expect(h.edges()).toEqual([]);
  });
});

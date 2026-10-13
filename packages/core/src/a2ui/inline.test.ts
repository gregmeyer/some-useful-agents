import { describe, it, expect } from 'vitest';
import { splitReply, stripInlineWidgets, parseInlineWidget, partialInlineWidget, chatWidgetGuide } from './inline.js';

const W = '{"components":[{"id":"root","component":"Column","children":["a","b"]},{"id":"a","component":"Metric","label":"Price","value":{"path":"/data/p"}},{"id":"b","component":"Text","text":"done"}],"data":{"p":"$5"}}';

describe('widgets in a chat reply', () => {
  it('splits text and widget blocks in order, and strips them for history', () => {
    const reply = `Here you go.\n<a2ui>${W}</a2ui>\nAnything else?`;
    expect(splitReply(reply).map((p) => p.kind)).toEqual(['text', 'widget', 'text']);
    expect(stripInlineWidgets(reply)).toBe('Here you go.\n(a widget)\nAnything else?');
    expect(splitReply('just text')).toEqual([{ kind: 'text', text: 'just text' }]);
  });

  it('parses a complete block, or says why not', () => {
    const ok = parseInlineWidget(W);
    expect('components' in ok && ok.components.length).toBe(3);
    expect('components' in ok && ok.data).toEqual({ p: '$5' });
    expect(parseInlineWidget('{"components":[{"id":"root","component":"Nope"}]}')).toMatchObject({ dropped: ['Nope'] }); // a note, not a lost reply
    expect(parseInlineWidget('not json')).toHaveProperty('error');
  });

  it('draws what is complete while the block is still being written, with "…" for children not written yet', () => {
    const half = `Look:\n<a2ui>${W.slice(0, W.indexOf('{"id":"b"') + 12)}`;
    const p = partialInlineWidget(half)!;
    expect(p.index).toBe(0);
    expect(p.count).toBe(2);
    expect(p.components.find((c) => c.id === 'b')).toMatchObject({ component: 'Text', text: '…' });
    expect(partialInlineWidget(`<a2ui>{"components":[{"id":"a","comp`)).toBeUndefined(); // no root yet
    expect(partialInlineWidget(`<a2ui>${W}</a2ui>`)).toBeUndefined(); // closed: the final render takes over
    expect(partialInlineWidget(`<a2ui>${W}</a2ui> then <a2ui>{"components":[{"id":"root","component":"Text","text":"x"}`)!.index).toBe(1);
  });

  it('ignores braces inside strings', () => {
    const p = partialInlineWidget('<a2ui>{"components":[{"id":"root","component":"Text","text":"a } { ] b"},{"id":"x"');
    expect(p!.count).toBe(1);
  });

  it('has a guide whose example parses', () => {
    const ex = /<a2ui>([\s\S]*?)<\/a2ui>/.exec(chatWidgetGuide())![1];
    expect(parseInlineWidget(ex)).toHaveProperty('components');
  });
});

describe('a widget with one wrong part', () => {
  const bad = '{"components":[{"id":"root","component":"Column","children":["s","t"]},{"id":"s","component":"StatStrip","stats":[{"label":"x","value":"1"}]},{"id":"t","component":"Table","rows":{"path":"/data/rows"},"columns":[{"key":"a","label":"A"}]}],"data":{"rows":[{"a":"1"}]}}';
  it('draws the rest, with a note for the part that does not check out', () => {
    const w = parseInlineWidget(bad);
    expect('components' in w).toBe(true);
    if (!('components' in w)) return;
    expect(w.dropped).toEqual(['StatStrip']);
    expect(w.components.find((c) => c.id === 's')).toMatchObject({ component: 'Text', text: "(a StatStrip that couldn't be drawn)" });
    expect(w.components.find((c) => c.id === 't')!.component).toBe('Table');
  });
  it('still draws live once that part is complete', () => {
    const p = partialInlineWidget(`<a2ui>${bad.slice(0, bad.indexOf('{"id":"t"'))}`);
    expect(p?.components.find((c) => c.id === 's')!.component).toBe('Text');
    expect(p?.components.find((c) => c.id === 't')).toMatchObject({ text: '…' });
  });
  it('the guide shows each component\'s properties', () => {
    expect(chatWidgetGuide()).toContain('"component":"StatStrip"');
    expect(chatWidgetGuide().length).toBeLessThan(4000);
    expect(chatWidgetGuide()).not.toMatch(/"\/(notebook|outputs|series)\//); // every example binds /data
  });
});

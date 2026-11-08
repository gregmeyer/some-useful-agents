import { describe, it, expect } from 'vitest';
import { NOTEBOOK_LAYOUT_PRESETS, type Notebook } from '@some-useful-agents/core';
import { countParts, optionWords } from './notebook-card.js';

const preset = (id: string) => NOTEBOOK_LAYOUT_PRESETS.find((p) => p.id === id)!.layout;
const nb = (layout?: Notebook['layout']) => ({ layout } as Pick<Notebook, 'layout'>);

describe('what a notebook card calls what it found', () => {
  it('a shortlist (or no layout) has options in the running; a briefing has topics, a company briefing or an answer findings', () => {
    expect(optionWords(nb())).toEqual({ one: 'option', many: 'options' });
    expect(optionWords(nb(preset('shortlist')))).toEqual({ one: 'option', many: 'options' });
    expect(optionWords(nb(preset('dossier')))).toEqual({ one: 'topic', many: 'topics' });
    expect(optionWords(nb(preset('company')))).toEqual({ one: 'finding', many: 'findings' });
    expect(optionWords(nb(preset('answer')))).toEqual({ one: 'finding', many: 'findings' });
  });

  it('counts a shortlist as options in the running, and a briefing as topics kept', () => {
    expect(countParts({ nb: nb() as Notebook, options: 12, active: 8, entries: 14 })).toEqual(['12 options', '8 in the running']);
    expect(countParts({ nb: nb(preset('dossier')) as Notebook, options: 12, active: 8, entries: 14 })).toEqual(['8 of 12 topics kept']);
    expect(countParts({ nb: nb(preset('dossier')) as Notebook, options: 12, active: 12, entries: 14 })).toEqual(['12 topics']);
    expect(countParts({ nb: nb(preset('company')) as Notebook, options: 1, active: 1, entries: 1 })).toEqual(['1 finding']);
    expect(countParts({ nb: nb(preset('dossier')) as Notebook, options: 0, active: 0, entries: 3 })).toEqual(['3 entries']);
  });
});

import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookLayout } from '@some-useful-agents/core';
import { hasTldrPicture, keepAskedTldrCard } from './tldr-card.js';

const page = (withPicture: boolean, form: 'path' | '@path' = 'path'): NotebookLayout => ({
  components: [
    { id: 'root', component: 'Column', children: withPicture ? ['pic', 'answer'] : ['answer'] },
    { id: 'answer', component: 'Text', text: 'x' },
    ...(withPicture ? [{ id: 'pic', component: 'Picture', picture: { [form]: '/notebook/picture' } }] : []),
  ],
} as NotebookLayout);

describe('the TL;DR card when you ask for it (ADR-0093)', () => {
  it('a page you had redrawn to show the TL;DR picture keeps its card (Always), unless you chose', () => {
    expect(hasTldrPicture(page(true))).toBe(true);
    expect(hasTldrPicture(page(true, '@path'))).toBe(true);
    expect(hasTldrPicture(page(false))).toBe(false);
    expect(hasTldrPicture({ components: [{ id: 'p', component: 'Picture', picture: { path: '/notebook/photo' } }] } as NotebookLayout)).toBe(false);

    const set: string[] = [];
    const store = (nb: Partial<Notebook>) => ({ get: () => nb as Notebook, setTldrCard: (_id: string, m: 'auto' | 'always' | 'never') => { set.push(m); return nb as Notebook; } });
    keepAskedTldrCard(store({}), 'nb', page(false), page(true));
    expect(set).toEqual(['always']);
    // Already there, or you chose: left as it is.
    keepAskedTldrCard(store({}), 'nb', page(true), page(true));
    keepAskedTldrCard(store({ tldrCard: 'never' }), 'nb', page(false), page(true));
    keepAskedTldrCard(store({}), 'nb', page(true), page(false));
    expect(set).toEqual(['always']);
  });
});

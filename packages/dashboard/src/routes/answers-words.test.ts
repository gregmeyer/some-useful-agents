import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { NotebookStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

// What you asked sua to find out is an answer: the pages you go through say
// so (URLs and names inside stay /notebooks).
const visible = (page: string) => page
  .replace(/<(script|style|template)[\s\S]*?<\/\1>/gi, ' ')
  // What a box or button says counts too.
  .replace(/\b(?:placeholder|aria-label|title)="([^"]*)"/g, '> $1 <')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');

describe('Answers', () => {
  it('/answers and anything under it go to the same page under /notebooks, the query kept', async () => {
    const app = await makeApp();
    const get = (p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await get('/answers')).headers.location).toBe('/notebooks');
    expect((await get('/answers/new?text=hot%20dogs')).headers.location).toBe('/notebooks/new?text=hot%20dogs');
    expect((await get('/answers/car/brief.html')).headers.location).toBe('/notebooks/car/brief.html');
  });

  it('the top bar, Home, the list, Ask a question and an answer\'s page say "answer", never "notebook"', async () => {
    const app = await makeApp();
    const get = async (p: string) => (await request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Is a hot dog a sandwich', statement: 'Settle it with sources' });
    for (const path of ['/', '/notebooks', '/notebooks/new', `/notebooks/${nb.id}`]) {
      const words = visible(await get(path));
      expect(words, path).toMatch(/\bAnswers?\b|\bAsk a question\b/);
      const said = words.match(/[^.]{0,40}\bnotebooks?\b[^.]{0,40}/gi) ?? [];
      expect(said, path).toEqual([]);
    }
  });
});

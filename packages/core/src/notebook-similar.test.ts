import { describe, it, expect } from 'vitest';
import { similarNotebooks, requestPurpose, notebookPurpose, topicWords } from './notebook-similar.js';
import type { Notebook, NotebookTags } from './notebooks.js';

let n = 0;
const nb = (title: string, over: Partial<Notebook> & { auto?: string[]; subject?: string } = {}): Notebook => {
  const { auto, subject, ...rest } = over;
  const tags: NotebookTags | undefined = auto || subject ? { auto: auto ?? [], added: [], removed: [], ...(subject ? { subject } : {}) } : undefined;
  n++;
  return {
    id: `nb-${String(n)}`, title, statement: '', params: [], criteria: [], pipeline: [], fields: [], stages: [], checks: [], cadence: '', status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: `2026-11-01T00:00:${String(n).padStart(2, '0')}.000Z`, ...(tags ? { tags } : {}), ...rest,
  };
};
const ids = (found: ReturnType<typeof similarNotebooks>) => found.map((f) => `${f.notebook.title}:${f.match}`);

describe('what an ask or a notebook is for', () => {
  it('reads the same words for both; an ask that says nothing is undefined', () => {
    expect(requestPurpose('Prepare for my meeting with Sam Ortiz')).toBe('meeting');
    expect(requestPurpose('Plan 4 days in Lisbon')).toBe('plan');
    expect(requestPurpose('Brief me on Initech')).toBe('report');
    expect(requestPurpose('Is a heat pump worth it?')).toBe('report');
    expect(requestPurpose('Help me choose a standing desk')).toBe('choose');
    expect(requestPurpose('standing desks')).toBeUndefined();
    expect(notebookPurpose(nb('Create a briefing on Initech'))).toBe('report');
    expect(notebookPurpose(nb('Buy a used AWD wagon'))).toBe('choose');
    expect(notebookPurpose(nb('Know Acme', { steps: [{ id: 's', title: 'Who', kind: 'profile', status: 'todo', tries: 0 }] }))).toBe('meeting');
  });

  it('topic words: no grammar, no words for asking or for a kind of notebook; plurals folded; short and accented words kept', () => {
    expect([...topicWords('Start a new notebook to find used cars under $26,000')]).toEqual(['used', 'car', '26', '000']);
    expect([...topicWords('Prepare for a meeting with Zoë, the AI PM')]).toEqual(['zoë', 'ai', 'pm']);
  });
});

describe('notebooks an ask could be', () => {
  const suv = nb('Find a used SUV', { statement: 'A reliable used SUV under $26,000', params: ['AWD'], auto: ['used cars', 'family'] });
  const guitar = nb('Search for an acoustic guitar with a pickup', { auto: ['acoustic guitars', 'travel guitars'] });
  const dana = nb('Prepare for my meeting with Dana Reyes', { statement: 'A brief on Dana Reyes', auto: ['sales', 'logistics'], subject: 'Dana Reyes' });
  const acme = nb('Create a briefing on Acme Corp', { auto: ['accounting services'], subject: 'Acme Corp' });
  const shoes = nb('Buy Hoka Challengers in size 9.5', { auto: ['running shoes', 'trail running'], subject: 'Hoka Challengers' });
  const all = [suv, guitar, dana, acme, shoes];

  it('the same topic: enough of the ask\'s words are the notebook\'s (its tags count)', () => {
    expect(ids(similarNotebooks('Find me a used SUV with AWD', all))).toEqual(['Find a used SUV:same-topic']);
    expect(ids(similarNotebooks('I want an acoustic guitar for travel', all))).toEqual(['Search for an acoustic guitar with a pickup:same-topic']);
    // One shared word isn't the same topic.
    expect(similarNotebooks('Find a used piano', all)).toEqual([]);
    expect(similarNotebooks('', all)).toEqual([]);
    expect(similarNotebooks('start a new notebook', all)).toEqual([]);
  });

  it('about someone by name: the same notebook only when the ask names them; otherwise the same kind for someone else', () => {
    expect(ids(similarNotebooks('Prepare for a meeting with Dana Reyes next week', all))).toEqual(['Prepare for my meeting with Dana Reyes:same-topic']);
    expect(ids(similarNotebooks('Prepare for my meeting with Sam Ortiz', all))).toEqual(['Prepare for my meeting with Dana Reyes:same-kind']);
    expect(ids(similarNotebooks('Brief me on Initech', all))).toEqual(['Create a briefing on Acme Corp:same-kind']);
    // A sales ask isn't a meeting: the meeting notebook's tag alone doesn't make it a match.
    expect(similarNotebooks('sales logistics', all)).toEqual([]);
    // A choice between things needs a shared topic word as well as the kind.
    expect(ids(similarNotebooks('Buy Brooks trail running shoes', all))).toEqual(['Buy Hoka Challengers in size 9.5:same-kind']);
    expect(similarNotebooks('Buy a standing desk', all)).toEqual([]);
  });

  it('a notebook run again counts once (the one in use, else the newest); archived ones are found; one same-kind at most', () => {
    const old = nb('Find a used SUV', { statement: 'A reliable used SUV', auto: ['used cars'], archivedAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' });
    const older = nb('find a used  suv', { auto: ['used cars'], archivedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z' });
    const found = similarNotebooks('find a used SUV', [older, old, suv]);
    expect(found).toHaveLength(1);
    expect(found[0].notebook.id).toBe(suv.id);
    // Only archived ones: the most recently changed.
    expect(similarNotebooks('find a used SUV', [older, old])[0].notebook.id).toBe(old.id);

    const sam = nb('Prepare for a meeting with Sam Ortiz', { subject: 'Sam Ortiz', archivedAt: '2026-11-03T00:00:00.000Z' });
    const kinds = similarNotebooks('Prepare for my meeting with Lee Park', [dana, sam]);
    expect(ids(kinds)).toEqual(['Prepare for my meeting with Dana Reyes:same-kind']);
    // The same topic comes before the same kind.
    expect(ids(similarNotebooks('Prepare for my meeting with Sam Ortiz', [dana, sam]))).toEqual(['Prepare for a meeting with Sam Ortiz:same-topic', 'Prepare for my meeting with Dana Reyes:same-kind']);
  });
});

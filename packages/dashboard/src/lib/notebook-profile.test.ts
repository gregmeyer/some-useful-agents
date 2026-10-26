import { describe, it, expect } from 'vitest';
import { profileSubject, readResearch, aboutFrom, PERSON_ASK } from './notebook-profile.js';

describe('a profile step\'s research', () => {
  it('is about its subject, else the notebook\'s title without "Prepare for a meeting with"', () => {
    expect(profileSubject({ title: 'Anything' }, { subject: 'Dana Reyes' })).toBe('Dana Reyes');
    expect(profileSubject({ title: 'Prepare for meeting with Dana Reyes' }, {})).toBe('Dana Reyes');
    expect(profileSubject({ title: 'Get ready for a call with Acme Robotics' }, {})).toBe('Acme Robotics');
    expect(profileSubject({ title: 'Learn about Maya Chen' }, {})).toBe('Maya Chen');
    expect(profileSubject({ title: 'Buy a used car' }, {})).toBe('Buy a used car');
  });

  it('reads research-one\'s JSON, keeps facts with their sources, and leaves out what steers the step', () => {
    const f = readResearch('log line\n{"found": {"kind": {"value": "person"}, "role": {"value": "COO", "source": "https://x.example", "quote": "COO"}, "photo_url": {"value": "https://x.example/a.png"}, "location": {"value": ""}}, "not_found": ["background", "photo_url"], "summary": "A COO."}');
    expect(f).toMatchObject({ notFound: ['background', 'photo_url'], summary: 'A COO.' });
    expect(aboutFrom(f!, PERSON_ASK)).toEqual({ facts: [{ key: 'role', label: 'Role', value: 'COO', source: 'https://x.example', quote: 'COO' }], notFound: ['Background'] });
    expect(readResearch('no json')).toBeUndefined();
    expect(readResearch(undefined)).toBeUndefined();
  });
});

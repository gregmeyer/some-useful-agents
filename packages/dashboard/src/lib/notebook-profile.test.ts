import { describe, it, expect } from 'vitest';
import { profileSubject, readResearch, aboutFrom, profileContext, withGivenLinkedIn, PERSON_ASK, COMPANY_ASK } from './notebook-profile.js';

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

  it('tells the researcher the links you gave first, then what it is for and the meeting', () => {
    const nb = { statement: 'Help me prepare for a meeting with Dana Reyes.', params: ['Dana Reyes'], meeting: { goal: 'a partnership', notes: 'Profile: https://www.linkedin.com/in/dana-reyes/' } };
    const c = profileContext(nb);
    expect(c.startsWith('Links you were given about them')).toBe(true);
    expect(c).toContain('https://www.linkedin.com/in/dana-reyes/');
    expect(c).toContain('Meeting goal: a partnership');
    expect(c).toContain('Already known: Profile:');
    expect(profileContext({ statement: 'Meet Dana.', params: [] })).toBe('Meet Dana.');
  });

  it('keeps a LinkedIn profile you gave as their LinkedIn, over one found, and not as missing', () => {
    const found = { facts: [{ key: 'role', label: 'Role', value: 'COO' }, { key: 'linkedin', label: 'LinkedIn', value: 'https://linkedin.com/in/someone-else' }], notFound: ['Based in'] };
    const given = 'https://www.linkedin.com/in/dana-reyes/';
    expect(withGivenLinkedIn(found, [given]).facts).toEqual([{ key: 'role', label: 'Role', value: 'COO' }, { key: 'linkedin', label: 'LinkedIn', value: given, source: given }]);
    expect(withGivenLinkedIn({ facts: [], notFound: ['LinkedIn', 'Based in'] }, [given]).notFound).toEqual(['Based in']);
    // A post or a company page isn't their profile.
    const notProfile = { facts: [], notFound: ['LinkedIn'] };
    expect(withGivenLinkedIn(notProfile, ['https://www.linkedin.com/posts/dana_x', 'https://www.linkedin.com/company/acme'])).toBe(notProfile);
  });

  it('keeps a number given as a range ("2–10"), as research-one gives sizes and amounts', () => {
    const f = readResearch('{"found": {"size": {"value": {"min": 2, "max": 10}, "source": "https://x.example"}, "revenue": {"value": {"min": 1000000}}, "founded": {"value": {"min": 2019, "max": 2019}}, "stage": {"value": {}}}, "not_found": []}')!;
    expect(aboutFrom(f, COMPANY_ASK).facts.map((x) => [x.key, x.value])).toEqual([['size', '2–10'], ['revenue', '1,000,000+'], ['founded', '2019']]);
  });
});

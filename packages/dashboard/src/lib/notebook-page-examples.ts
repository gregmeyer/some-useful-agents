/**
 * Example notebooks, one per kind of job a notebook does, for checking that
 * each still gets a page that fits it (lib/notebook-page-examples.test.ts on
 * every change; scripts/notebook-pages/ asks the real page agent and opens
 * the pages in a browser). Each is set up as a new notebook is (what it's
 * for, the facts it notes, its steps) and, with `data`, filled as its steps
 * would fill it (options, facts about who it's about, a search). Names,
 * places and pages are invented.
 */
import type { NotebookStore } from '@some-useful-agents/core';

export interface NotebookPageExample {
  id: string;
  /** What the notebook is for, in a few words. */
  job: string;
  /**
   * The page it should get: the shortlist (choosing among many), the
   * Meeting briefing (dossier), or one drawn for it, of a `kind` (a report
   * answering a question, a plan).
   */
  expect: { page: 'shortlist' | 'dossier' | 'answer' | 'plan' | 'watch' | 'drawn'; kind?: string; needs?: string[] };
  /** Make it in `s` and return its id; with `data`, as its steps would leave it. */
  seed: (s: NotebookStore, opts: { data: boolean }) => string;
}

const AT = '2026-10-20T15:00:00.000Z';
const src = (path: string) => `https://example.com/${path}`;

function options(s: NotebookStore, id: string, rows: Array<[string, Record<string, string | number | { min: number; max: number }>]>): string[] {
  return rows.map(([title, data]) => s.upsertOption(id, { title, by: 'agent:example-finder', data }).entry.id);
}

export const NOTEBOOK_PAGE_EXAMPLES: readonly NotebookPageExample[] = [
  {
    id: 'car',
    job: 'buy a used car',
    expect: { page: 'shortlist' },
    seed(s, { data }) {
      const nb = s.create({ title: 'Buy a used AWD wagon', statement: 'A reliable AWD wagon for ski trips', params: ['$6k-$9k budget', '90k-150k miles', 'AWD'], criteria: ['Clean title', 'Test driven'] });
      s.setFields(nb.id, [
        { key: 'price', label: 'Price', type: 'money', role: 'price' },
        { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' },
        { key: 'seller', label: 'Seller', type: 'text' },
        { key: 'url', label: 'Listing', type: 'url', role: 'link' },
      ]);
      s.setSteps(nb.id, [
        { title: 'Find 8 wagons', kind: 'find', target: 8 },
        { title: 'Check title and history', kind: 'check' },
        { title: 'Pick one to test drive', kind: 'decide', target: 1 },
      ]);
      if (data) {
        const [a, , c] = options(s, nb.id, [
          ['2014 Outback 2.5i, Tacoma', { price: 8400, miles: 121000, seller: 'dealer', url: src('cars/1') }],
          ['2012 Forester, Everett', { price: 6900, miles: 142000, seller: 'private', url: src('cars/2') }],
          ['2015 Golf SportWagen 4Motion', { price: 9600, miles: 98000, seller: 'dealer', url: src('cars/3') }],
          ['2013 Outback Limited, Renton', { price: 7800, miles: 133500, seller: 'private', url: src('cars/4') }],
        ]);
        s.ruleOut(nb.id, c, 'over budget');
        s.checkOption(nb.id, a, 'Clean title', true);
        s.recordSearch(nb.id, 'example-finder', 'run-car-1', 4, AT, [{ name: 'Listings A', status: 'found', found: 3 }, { name: 'Listings B', status: 'found', found: 1 }]);
      }
      return nb.id;
    },
  },
  {
    id: 'job',
    job: 'find a job',
    expect: { page: 'shortlist' },
    seed(s, { data }) {
      const nb = s.create({ title: 'Find a staff designer role', statement: 'A remote staff product design role at a small company', params: ['remote', '$170k-$210k'], criteria: ['Applied to 3'] });
      s.setFields(nb.id, [
        { key: 'company', label: 'Company', type: 'text', role: 'org' },
        { key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher', range: true },
        { key: 'location', label: 'Location', type: 'text', role: 'place' },
        { key: 'url', label: 'Posting', type: 'url', role: 'link' },
      ]);
      s.setSteps(nb.id, [{ title: 'Find 10 roles', kind: 'find', target: 10 }, { title: 'Pick 3 to apply to', kind: 'decide', target: 3 }]);
      if (data) {
        options(s, nb.id, [
          ['Staff Product Designer, Northwind', { company: 'Northwind', salary: { min: 180000, max: 205000 }, location: 'Remote (US)', url: src('jobs/1') }],
          ['Principal Designer, Fabrikam', { company: 'Fabrikam', salary: { min: 190000, max: 220000 }, location: 'Remote', url: src('jobs/2') }],
          ['Staff Designer, Tailspin', { company: 'Tailspin', salary: { min: 165000, max: 185000 }, location: 'Remote (EU/US)', url: src('jobs/3') }],
        ]);
        s.recordSearch(nb.id, 'example-finder', 'run-job-1', 3, AT, [{ name: 'Search', status: 'found', found: 3 }]);
      }
      return nb.id;
    },
  },
  {
    id: 'accounts',
    job: 'find accounts that fit',
    expect: { page: 'shortlist' },
    seed(s, { data }) {
      const nb = s.create({ title: 'Find 5 logistics accounts', statement: 'Mid-size logistics companies that fit our ICP', params: ['$10M-$50M revenue', '50-500 employees'], criteria: ['5 accounts at 70+ fit'] });
      s.setFields(nb.id, [
        { key: 'fit', label: 'Fit', type: 'number', role: 'score', better: 'higher' },
        { key: 'employees', label: 'Employees', type: 'number', role: 'measure' },
        { key: 'revenue', label: 'Revenue', type: 'money' },
        { key: 'site', label: 'Website', type: 'url', role: 'link' },
      ]);
      s.setSteps(nb.id, [
        { title: 'Find 12 companies', kind: 'find', target: 12 },
        { title: 'Source firmographics', kind: 'source', facts: ['employees', 'revenue'] },
        { title: 'Score fit', kind: 'check' },
        { title: 'Pick the final 5', kind: 'decide', target: 5 },
      ]);
      if (data) {
        options(s, nb.id, [
          ['Harbor Freightlines', { fit: 86, employees: 240, revenue: 31000000, site: src('harbor') }],
          ['Cascade Cold Chain', { fit: 74, employees: 120, revenue: 18000000, site: src('cascade') }],
          ['Ridgeway Parcel', { fit: 58, employees: 410, revenue: 47000000, site: src('ridgeway') }],
        ]);
        s.recordSearch(nb.id, 'example-finder', 'run-acct-1', 3, AT, [{ name: 'Search', status: 'found', found: 3 }]);
      }
      return nb.id;
    },
  },
  {
    id: 'product',
    job: 'buy a product',
    expect: { page: 'shortlist' },
    seed(s, { data }) {
      const nb = s.create({ title: 'Pick a standing desk', statement: 'A sturdy standing desk under $700', params: ['under $700', '60in wide'], criteria: ['Checked the warranty'] });
      s.setFields(nb.id, [
        { key: 'price', label: 'Price', type: 'money', role: 'price' },
        { key: 'rating', label: 'Rating', type: 'number', role: 'measure', better: 'higher' },
        { key: 'warranty', label: 'Warranty', type: 'text' },
        { key: 'url', label: 'Page', type: 'url', role: 'link' },
      ]);
      s.setSteps(nb.id, [{ title: 'Find 6 desks', kind: 'find', target: 6 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
      if (data) {
        options(s, nb.id, [
          ['Uplift-style V2, 60x30', { price: 649, rating: 4.7, warranty: '15 years', url: src('desk/1') }],
          ['Basic dual-motor, 60x24', { price: 429, rating: 4.3, warranty: '5 years', url: src('desk/2') }],
        ]);
        s.recordSearch(nb.id, 'example-finder', 'run-desk-1', 2, AT, [{ name: 'Search', status: 'found', found: 2 }]);
      }
      return nb.id;
    },
  },
  {
    id: 'meet-person',
    job: 'prepare to meet a person',
    expect: { page: 'dossier', needs: ['ProfileCard', 'FactSheet', 'Agenda', 'QuoteList'] },
    seed(s, { data }) {
      const nb = s.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'What matters to Dana before our partnership call', params: ['30 minutes'], criteria: ['Talking points chosen'] });
      s.setFields(nb.id, [
        { key: 'theme', label: 'Theme', type: 'text' },
        { key: 'evidence', label: 'What suggests it matters to her', type: 'text' },
        { key: 'source_url', label: 'Source', type: 'url', role: 'link' },
        { key: 'conversation_question', label: 'Question to ask', type: 'text' },
      ]);
      s.setSteps(nb.id, [
        { title: 'Learn about Dana Reyes and her company', kind: 'profile', subject: 'Dana Reyes' },
        { title: 'Find what Dana has written or said', kind: 'find', target: 5 },
        { title: 'Write the talking points', kind: 'write', target: 3 },
      ]);
      if (data) {
        s.setAbout(nb.id, 'person', {
          name: 'Dana Reyes', summary: 'Head of partnerships at Lumen Freight; writes about small, targeted outbound.',
          facts: [
            { key: 'role', label: 'Role', value: 'Head of Partnerships', source: src('lumen/team') },
            { key: 'organization', label: 'Company', value: 'Lumen Freight', source: src('lumen/team') },
            { key: 'location', label: 'Location', value: 'Denver, CO', source: src('dana/about') },
            { key: 'background', label: 'Background', value: '10 years in freight sales; ran a micro-campaign masterclass', source: src('dana/about') },
          ],
          notFound: ['Education'],
        }, AT);
        s.setAbout(nb.id, 'company', {
          name: 'Lumen Freight',
          facts: [
            { key: 'what_they_do', label: 'What they do', value: 'Freight visibility software for regional carriers', source: src('lumen') },
            { key: 'size', label: 'Size', value: 'About 140 people', source: src('lumen/about') },
            { key: 'stage', label: 'Stage', value: 'Series B (2025)', source: src('lumen/news') },
          ],
        }, AT);
        const add = (title: string, theme: string, evidence: string, q: string, n: number) =>
          s.upsertOption(nb.id, { title, by: 'agent:example-finder', data: { theme, evidence, source_url: src(`dana/post-${n}`), conversation_question: q } }).entry.id;
        const a = add('Signals over lists', 'Buying signals', 'She would rather work the right 50 accounts than a list of 5,000.', 'Which signals do you trust most?', 1);
        add('Human work', 'Where people beat AI', 'She writes her first drafts herself, then edits with AI.', 'What do you never hand to AI?', 2);
        add('Small campaigns', 'Buying signals', 'She ran a masterclass on micro-campaigns for carriers.', 'How small is too small for a campaign?', 3);
        add('Partner-led growth', 'Partnerships', 'Half of Lumen’s pipeline came through two partners last year.', 'What makes a partner worth the setup?', 4);
        s.choose(nb.id, a);
        s.setBriefing(nb.id, {
          points: [
            { text: 'Ask which buying signals she trusts before reaching out', why: 'She would rather work the right 50 accounts than 5,000.', ask: 'Which signals do you trust most?', from: [a] },
            { text: 'Talk about where people still beat AI in her team', why: 'She writes her first drafts herself.', from: [] },
            { text: 'Compare notes on partner-led pipeline', why: 'Half of Lumen\u2019s pipeline came through two partners.', ask: 'What makes a partner worth the setup?', from: [] },
          ],
          questions: ['How small is too small for a campaign?'], watch: ['Don\u2019t pitch list volume'], at: AT, by: 'notebook-writer',
        });
        s.recordSearch(nb.id, 'example-finder', 'run-dana-1', 4, AT, [{ name: 'Her blog', status: 'found', found: 3 }, { name: 'Podcasts', status: 'found', found: 1 }]);
      }
      return nb.id;
    },
  },
  {
    id: 'meet-company',
    job: 'prepare for a call with a company',
    expect: { page: 'dossier', needs: ['ProfileCard', 'FactSheet', 'Agenda'] },
    seed(s, { data }) {
      const nb = s.create({ title: 'Prepare for a call with Acme Robotics', statement: 'Know Acme Robotics before the vendor review', params: ['45 minutes'], criteria: ['Questions ready'] });
      s.setFields(nb.id, [
        { key: 'topic', label: 'Topic', type: 'text' },
        { key: 'what_they_said', label: 'What they said', type: 'text' },
        { key: 'link', label: 'Source', type: 'url', role: 'link' },
        { key: 'question', label: 'Question to ask', type: 'text' },
      ]);
      s.setSteps(nb.id, [
        { title: 'Learn about Acme Robotics', kind: 'profile', subject: 'Acme Robotics' },
        { title: 'Find what Acme has announced', kind: 'find', target: 4 },
      ]);
      if (data) {
        s.setAbout(nb.id, 'company', {
          name: 'Acme Robotics', summary: 'Makes warehouse picking robots for mid-size distributors.',
          facts: [
            { key: 'what_they_do', label: 'What they do', value: 'Warehouse picking robots', source: src('acme') },
            { key: 'size', label: 'Size', value: 'About 400 people', source: src('acme/about') },
            { key: 'funding', label: 'Funding', value: '$85M raised, Series C', source: src('acme/news') },
            { key: 'hq', label: 'Headquarters', value: 'Pittsburgh, PA', source: src('acme/about') },
          ],
        }, AT);
        const add = (title: string, topic: string, said: string, q: string, n: number) =>
          s.upsertOption(nb.id, { title, by: 'agent:example-finder', data: { topic, what_they_said: said, link: src(`acme/news-${n}`), question: q } }).entry.id;
        add('New picking arm', 'Product', 'The new arm picks 30% more items an hour than last year’s.', 'How does it do on mixed-size items?', 1);
        add('European expansion', 'Growth', 'Acme opened a Rotterdam office to serve EU distributors.', 'Who supports US customers overnight?', 2);
        add('Robots as a service', 'Pricing', 'Most new customers rent robots by the month.', 'What does a 12-month rental cost?', 3);
        s.recordSearch(nb.id, 'example-finder', 'run-acme-1', 3, AT, [{ name: 'Press releases', status: 'found', found: 2 }, { name: 'Trade news', status: 'found', found: 1 }]);
      }
      return nb.id;
    },
  },
  {
    id: 'question',
    job: 'answer a question',
    expect: { page: 'answer', needs: ['Callout', 'Agenda', 'OptionGrid'] },
    seed(s, { data }) {
      const nb = s.create({ title: 'Is a heat pump worth it in a cold climate?', statement: 'Find out whether a cold-climate heat pump pays off for a 1,800 sq ft house in Minneapolis', params: ['winters to -20°F', 'gas furnace today'], criteria: ['An answer with the payback in years'] });
      s.setFields(nb.id, [
        { key: 'finding', label: 'Finding', type: 'text' },
        { key: 'evidence', label: 'Evidence', type: 'text' },
        { key: 'source', label: 'Source', type: 'url', role: 'link' },
        { key: 'published', label: 'Published', type: 'date', role: 'when' },
      ]);
      s.setSteps(nb.id, [
        { title: 'Find 6 studies and field reports', kind: 'find', target: 6 },
        { title: 'Check each one is about cold climates', kind: 'check' },
        { title: 'Write the answer', kind: 'write', shape: 'answer' },
      ]);
      if (data) {
        options(s, nb.id, [
          ['Field study: 2 winters in Minnesota', { finding: 'Cold-climate units kept homes warm down to -13°F without backup', evidence: 'Measured COP stayed above 1.5 at -13°F.', source: src('study/mn'), published: '2025-03-01' }],
          ['Utility rebate guide', { finding: 'Rebates cover $2,000-$8,000 of the install', evidence: 'Income-qualified homes get up to $8,000.', source: src('rebates'), published: '2026-01-15' }],
          ['Payback calculator write-up', { finding: 'Payback of 7-12 years against gas at today’s prices', evidence: 'Gas at $1.10/therm, power at $0.14/kWh.', source: src('payback'), published: '2026-06-02' }],
        ]);
        s.recordSearch(nb.id, 'example-finder', 'run-heat-1', 3, AT, [{ name: 'Studies', status: 'found', found: 1 }, { name: 'Utilities', status: 'found', found: 2 }]);
        const [study, rebates, payback] = s.entries(nb.id, 10).filter((e) => e.kind === 'option').map((e) => e.id).reverse();
        s.setAnswer(nb.id, {
          question: 'Find out whether a cold-climate heat pump pays off for a 1,800 sq ft house in Minneapolis', text: 'Yes, in about **7 to 12 years** against gas at today’s prices, and sooner with a rebate.',
          confidence: 'medium', basis: 'One field study and one calculator; prices change.',
          findings: [{ text: 'Cold-climate units kept homes warm down to -13°F.', from: [study] }, { text: 'Rebates cover $2,000-$8,000.', from: [rebates] }, { text: 'Payback is 7-12 years against gas.', from: [payback] }],
          open: ['What does the house’s own gas bill say?'], at: AT, by: 'notebook-writer',
        });
      }
      return nb.id;
    },
  },
  {
    id: 'trip',
    job: 'plan a trip',
    expect: { page: 'plan', needs: ['Itinerary', 'OptionGrid'] },
    seed(s, { data }) {
      const nb = s.create({ title: 'Plan 4 days in Lisbon', statement: 'A 4-day Lisbon trip in March for two, food and walking', params: ['March', '$1,500 for two, not counting flights'], criteria: ['A day-by-day plan', 'Dinners booked'] });
      s.setFields(nb.id, [
        { key: 'day', label: 'Day', type: 'number' },
        { key: 'what', label: 'What', type: 'text' },
        { key: 'cost', label: 'Cost', type: 'money', role: 'price' },
        { key: 'area', label: 'Area', type: 'text', role: 'place' },
        { key: 'link', label: 'Link', type: 'url', role: 'link' },
      ]);
      s.setSteps(nb.id, [
        { title: 'Find 12 things to do and eat', kind: 'find', target: 12 },
        { title: 'Write the plan', kind: 'write', shape: 'plan' },
      ]);
      if (data) {
        options(s, nb.id, [
          ['Alfama walk and the castle', { day: 1, what: 'Morning walk up to the castle', cost: 30, area: 'Alfama', link: src('lisbon/alfama') }],
          ['Dinner at a fado house', { day: 1, what: 'Fado and dinner', cost: 120, area: 'Alfama', link: src('lisbon/fado') }],
          ['Belém and the tile museum', { day: 2, what: 'Monastery, tarts, tile museum', cost: 45, area: 'Belém', link: src('lisbon/belem') }],
          ['Day trip to Sintra', { day: 3, what: 'Train to Sintra, palaces', cost: 80, area: 'Sintra', link: src('lisbon/sintra') }],
        ]);
        s.recordSearch(nb.id, 'example-finder', 'run-lisbon-1', 4, AT, [{ name: 'Guides', status: 'found', found: 3 }, { name: 'Restaurants', status: 'found', found: 1 }]);
        const [alfama, fado, belem, sintra] = s.entries(nb.id, 10).filter((e) => e.kind === 'option').map((e) => e.id).reverse();
        s.setPlan(nb.id, {
          summary: 'Old Lisbon first, then **Belém and Sintra**, keeping the last day loose. About $280 for two before meals.',
          items: [
            { when: 'Day 1', title: 'Walk up through Alfama to the castle', detail: 'Mornings are cooler; about 3 hours.', from: [alfama] },
            { when: 'Day 1', title: 'Fado and dinner', detail: 'Book ahead; about $120 for two.', from: [fado] },
            { when: 'Day 2', title: 'Belém: the monastery, tarts and the tile museum', from: [belem] },
            { when: 'Day 3', title: 'Train to Sintra for the palaces', detail: 'Leave early; about $80 for two.', from: [sintra] },
            { when: 'Day 4', title: 'Free day: markets and a last walk', from: [] },
          ],
          before: ['Book the fado dinner', 'Buy Sintra palace tickets online'], open: ['Which palace in Sintra?'], at: AT, by: 'notebook-writer',
        });
      }
      return nb.id;
    },
  },
  {
    id: 'watch',
    job: 'keep watch on prices',
    expect: { page: 'watch', needs: ['Changes', 'OptionGrid'] },
    seed(s, { data }) {
      const nb = s.create({ title: 'Watch for a used Fujifilm X100V under $1,200', statement: 'Tell me when a used X100V in good shape shows up under $1,200 near Seattle', params: ['under $1,200', 'good or better condition'], criteria: ['One I can buy'], cadence: '0 8 * * *' });
      s.setFields(nb.id, [
        { key: 'price', label: 'Price', type: 'money', role: 'price', better: 'lower' },
        { key: 'condition', label: 'Condition', type: 'text' },
        { key: 'seller', label: 'Seller', type: 'text', role: 'place' },
        { key: 'listing', label: 'Listing', type: 'url', role: 'link' },
      ]);
      s.setSteps(nb.id, [{ title: 'Find X100V listings under $1,200', kind: 'find', target: 5 }]);
      if (data) {
        // The search before found one; the latest found two new ones, and not that one.
        s.recordSearch(nb.id, 'example-finder', 'run-x100-1', 1, '2026-10-19T08:00:00.000Z');
        options(s, nb.id, [['X100V, silver, box and charger', { price: 1150, condition: 'Excellent', seller: 'Camera shop', listing: src('x100v/1') }]]);
        s.recordSearch(nb.id, 'example-finder', 'run-x100-2', 2, new Date().toISOString());
        options(s, nb.id, [
          ['X100V, black, two batteries', { price: 1090, condition: 'Good', seller: 'Private', listing: src('x100v/2') }],
          ['X100V with lens hood', { price: 1199, condition: 'Like new', seller: 'Marketplace', listing: src('x100v/3') }],
        ]);
      }
      return nb.id;
    },
  },
];

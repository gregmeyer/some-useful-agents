import { describe, it, expect } from 'vitest';
import { extractField, renderOutputWidget } from './output-widgets.js';

describe('extractField', () => {
  // Whole-output JSON (the fast path)
  it('reads a top-level key from pure JSON output', () => {
    expect(extractField('{"total":4,"label":"hi"}', 'total')).toBe('4');
    expect(extractField('{"total":4,"label":"hi"}', 'label')).toBe('hi');
  });

  it('falls back to deep search for branch-node merged shape', () => {
    const out = '{"merged":{"node-a":{"answer":"yes"}}}';
    expect(extractField(out, 'answer')).toBe('yes');
  });

  it('serialises non-string values as pretty JSON', () => {
    const out = '{"items":[1,2,3]}';
    expect(extractField(out, 'items')).toBe('[\n  1,\n  2,\n  3\n]');
  });

  // XML-tag mode (legacy agent-analyzer pattern)
  it('reads <tag>value</tag> markers', () => {
    expect(extractField('text <answer>42</answer> more', 'answer')).toBe('42');
  });

  it('XML-tag mode beats whole-output JSON when both match', () => {
    const out = '<answer>tag wins</answer>{"answer":"json"}';
    expect(extractField(out, 'answer')).toBe('tag wins');
  });

  // The bug this commit fixes: prose followed by a JSON object.
  // claude-code summarisers commonly produce this shape — human-readable
  // narrative for `run.result`, plus a final JSON line that drives the
  // widget. Before this fix, `JSON.parse(entire output)` failed and the
  // widget rendered empty.
  it('extracts a trailing JSON object after human prose', () => {
    const out = [
      '**Churn Brief — 2026-05-14**',
      '',
      '- iris@example.com (pro)',
      '- henry@example.com (team)',
      '',
      '{"total_churned": 4, "recent_count": 4, "summary": "..."}',
    ].join('\n');
    expect(extractField(out, 'total_churned')).toBe('4');
    expect(extractField(out, 'recent_count')).toBe('4');
    expect(extractField(out, 'summary')).toBe('...');
  });

  it('prefers the rightmost / smallest trailing object when multiple exist', () => {
    // Agent wrote `{"draft":1}` mid-output, then the final widget JSON.
    // The rightmost balanced object is what counts as the agent's verdict.
    const out = 'draft attempt {"draft":1}\nfinal {"answer":"yes"}';
    expect(extractField(out, 'answer')).toBe('yes');
    // The earlier `draft` key isn't visible because we stop at the
    // smallest trailing object — that's the intended contract.
    expect(extractField('alone {"draft":1}', 'draft')).toBe('1');
  });

  it('handles strings that contain `{` or `}` inside values', () => {
    const out = 'preface {"raw":"a{b}c","ok":true}';
    expect(extractField(out, 'raw')).toBe('a{b}c');
    expect(extractField(out, 'ok')).toBe('true');
  });

  it('returns undefined when no JSON or tag is present', () => {
    expect(extractField('just plain prose, no markers', 'anything')).toBeUndefined();
  });

  it('returns undefined when the trailing brace is unmatched', () => {
    // `}` exists but no preceding `{` parses → no rescue.
    expect(extractField('text } end', 'x')).toBeUndefined();
  });

  it('ignores primitive JSON at root', () => {
    // A bare quoted string parses as JSON but has no fields to extract.
    expect(extractField('"just a string"', 'x')).toBeUndefined();
    expect(extractField('42', 'x')).toBeUndefined();
  });
});

describe('renderOutputWidget — ai-template arrays', () => {
  // Regression for ccusage-daily and similar agents: claude-code
  // summarisers wrap their JSON in prose / markdown fences, e.g.
  //   "Note: data is incomplete\n```json\n{ ... }\n```\nCaveat: ..."
  // The prior renderer did a bare `JSON.parse(output)` which threw on
  // anything other than pure JSON, so top-level arrays never reached
  // the outputs map and `{{#each}}` blocks rendered empty. Switching
  // to `parseJsonFromOutput` recovers the embedded object.
  it('populates {{#each}} from JSON wrapped in prose + a markdown fence', () => {
    const schema = {
      type: 'ai-template' as const,
      template: '<ul>{{#each outputs.rows as row}}<li data-d="{{row.date}}">{{row.label}}</li>{{/each}}</ul>',
    };
    const output = [
      'Heads up: the upstream feed was truncated.',
      '```json',
      JSON.stringify({
        rows: [
          { date: '2026-05-10', label: 'alpha' },
          { date: '2026-05-11', label: 'beta' },
          { date: '2026-05-12', label: 'gamma' },
        ],
      }),
      '```',
      'Note: I used the most recent three days.',
    ].join('\n');

    const out = String(renderOutputWidget(schema, output, 'test-agent') ?? '');
    expect(out).toContain('data-d="2026-05-10"');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
    expect(out).toContain('gamma');
    // Sanity: the loop body fired three times (one <li> per row).
    expect((out.match(/<li /g) ?? []).length).toBe(3);
  });

  it('still works for a pure-JSON output (no regression on the fast path)', () => {
    const schema = {
      type: 'ai-template' as const,
      template: '<p>{{outputs.count}}</p><ul>{{#each outputs.items as i}}<li>{{i}}</li>{{/each}}</ul>',
    };
    const out = String(renderOutputWidget(schema, '{"count":3,"items":["a","b","c"]}', 'test-agent') ?? '');
    expect(out).toContain('<p>3</p>');
    expect(out).toContain('<li>a</li>');
    expect(out).toContain('<li>b</li>');
    expect(out).toContain('<li>c</li>');
  });
});

describe('renderOutputWidget — sort / filter / paginate controls', () => {
  const baseTemplate = '<ul>{{#each outputs.rows as r}}<li>{{r.name}}|{{r.cost}}</li>{{/each}}</ul>';
  const rows = [
    { name: 'alpha', cost: 100 },
    { name: 'beta', cost: 50 },
    { name: 'gamma', cost: 200 },
    { name: 'delta', cost: 75 },
    { name: 'epsilon', cost: 125 },
  ];
  const output = JSON.stringify({ rows });

  function rowsFromHtml(html: string): string[] {
    return [...html.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
  }

  it('sort: applies the default sort when no state is supplied', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'sort' as const, field: 'rows', columns: ['name', 'cost'], default: 'cost desc' }],
    };
    const out = String(renderOutputWidget(schema, output, 'a', {}) ?? '');
    expect(rowsFromHtml(out)).toEqual([
      'gamma|200', 'epsilon|125', 'alpha|100', 'delta|75', 'beta|50',
    ]);
    // Controls row renders with active sort indicator.
    expect(out).toContain('data-widget-control="sort"');
    expect(out).toContain('↓'); // desc arrow on the active column
  });

  it('sort: URL state overrides the schema default', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'sort' as const, field: 'rows', columns: ['name', 'cost'], default: 'cost desc' }],
    };
    const out = String(renderOutputWidget(schema, output, 'a', {
      sort: new Map([['rows', { column: 'name', direction: 'asc' }]]),
    }) ?? '');
    expect(rowsFromHtml(out)).toEqual([
      'alpha|100', 'beta|50', 'delta|75', 'epsilon|125', 'gamma|200',
    ]);
  });

  it('filter: keeps rows whose listed columns contain the query (case-insensitive)', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'filter' as const, field: 'rows', columns: ['name'] }],
    };
    const out = String(renderOutputWidget(schema, output, 'a', {
      filter: new Map([['rows', 'TA']]),
    }) ?? '');
    // alpha (no "ta"), beta (be-TA ✓), gamma (no), delta (del-TA ✓), epsilon (no).
    expect(rowsFromHtml(out)).toEqual(['beta|50', 'delta|75']);
  });

  it('paginate: slices the array and reports page info', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'paginate' as const, field: 'rows', pageSize: 2 }],
    };
    const page2 = String(renderOutputWidget(schema, output, 'a', {
      page: new Map([['rows', 2]]),
    }) ?? '');
    expect(rowsFromHtml(page2)).toEqual(['gamma|200', 'delta|75']);
    expect(page2).toContain('page 2 of 3');
    expect(page2).toContain('5 rows');
    expect(page2.match(/data-widget-control="paginate-prev"/g)).toHaveLength(1);
    expect(page2.match(/data-widget-control="paginate-next"/g)).toHaveLength(1);
  });

  it('paginate: prev disabled on page 1, next disabled on last page', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'paginate' as const, field: 'rows', pageSize: 2 }],
    };
    const page1 = String(renderOutputWidget(schema, output, 'a', {
      page: new Map([['rows', 1]]),
    }) ?? '');
    expect(page1).not.toContain('data-widget-control="paginate-prev"');
    expect(page1).toContain('data-widget-control="paginate-next"');
    const page3 = String(renderOutputWidget(schema, output, 'a', {
      page: new Map([['rows', 3]]),
    }) ?? '');
    expect(page3).toContain('data-widget-control="paginate-prev"');
    expect(page3).not.toContain('data-widget-control="paginate-next"');
  });

  it('combined: filter → sort → paginate run in that order', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [
        { type: 'filter' as const, field: 'rows', columns: ['name'] },
        { type: 'sort' as const, field: 'rows', columns: ['cost'] },
        { type: 'paginate' as const, field: 'rows', pageSize: 2 },
      ],
    };
    // Filter "a" keeps alpha, beta, gamma, delta (4 of 5 — epsilon has no "a").
    // Sort cost asc: beta(50), delta(75), alpha(100), gamma(200). Page 2 of 2.
    const out = String(renderOutputWidget(schema, output, 'agent', {
      filter: new Map([['rows', 'a']]),
      sort: new Map([['rows', { column: 'cost', direction: 'asc' }]]),
      page: new Map([['rows', 2]]),
    }) ?? '');
    expect(rowsFromHtml(out)).toEqual(['alpha|100', 'gamma|200']);
    expect(out).toContain('page 2 of 2');
    expect(out).toContain('4 rows');
  });

  it('clamps page to the valid range and no-ops on non-array fields', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'paginate' as const, field: 'rows', pageSize: 2 }],
    };
    const out = String(renderOutputWidget(schema, output, 'a', {
      page: new Map([['rows', 99]]),
    }) ?? '');
    expect(out).toContain('page 3 of 3');
    const noArr = String(renderOutputWidget(schema, '{"rows":"not an array"}', 'a', {
      page: new Map([['rows', 1]]),
    }) ?? '');
    expect(noArr).toContain('page —');
  });

  // ── regression: per-field state isolation ────────────────────────────
  // Two sort controls on different fields (the ccusage-daily shape:
  // `daily` + `models`) must keep INDEPENDENT state. Previously a single
  // global `?ws=` applied to every sort control whose column list
  // contained the named column — sorting `daily` by `tokens` also
  // re-sorted `models` because both control's columns included `tokens`.
  it('two sort controls on different fields keep independent state', () => {
    const data = JSON.stringify({
      daily: [
        { date: '2026-05-15', tokens: 100 },
        { date: '2026-05-14', tokens: 300 },
        { date: '2026-05-13', tokens: 200 },
      ],
      models: [
        { name: 'opus', tokens: 1000 },
        { name: 'haiku', tokens: 50 },
        { name: 'sonnet', tokens: 500 },
      ],
    });
    const schema = {
      type: 'ai-template' as const,
      template:
        '<table id="daily">{{#each outputs.daily as d}}<tr><td>{{d.date}}</td></tr>{{/each}}</table>' +
        '<table id="models">{{#each outputs.models as m}}<tr><td>{{m.name}}</td></tr>{{/each}}</table>',
      controls: [
        { type: 'sort' as const, field: 'daily', columns: ['date', 'tokens'] },
        { type: 'sort' as const, field: 'models', columns: ['name', 'tokens'] },
      ],
    };
    // Sort daily by tokens-asc. Models should be UNCHANGED (no models
    // sort instruction; no default; original order preserved).
    const out = String(renderOutputWidget(schema, data, 'agent', {
      sort: new Map([['daily', { column: 'tokens', direction: 'asc' }]]),
    }) ?? '');
    const dailyDates = [...out.matchAll(/<table id="daily">[\s\S]*?<\/table>/g)][0]?.[0]
      .match(/2026-05-\d\d/g) ?? [];
    const modelNames = [...out.matchAll(/<table id="models">[\s\S]*?<\/table>/g)][0]?.[0]
      .match(/(opus|haiku|sonnet)/g) ?? [];
    expect(dailyDates).toEqual(['2026-05-15', '2026-05-13', '2026-05-14']); // tokens asc: 100, 200, 300
    expect(modelNames).toEqual(['opus', 'haiku', 'sonnet']);                 // untouched
  });

  // ── regression: numeric sort handles currency-prefixed strings ─────
  // ccusage-daily's `models[].cost` is `"$711.63"` etc. Previously these
  // sorted as strings — `"$2.89"` came before `"$711.63"` alphabetically,
  // breaking "cost desc" ordering.
  it('sorts $-prefixed numeric strings as numbers', () => {
    const data = JSON.stringify({
      rows: [
        { name: 'a', cost: '$711.63' },
        { name: 'b', cost: '$12.54' },
        { name: 'c', cost: '$2.89' },
      ],
    });
    const schema = {
      type: 'ai-template' as const,
      template: '<ul>{{#each outputs.rows as r}}<li>{{r.name}}|{{r.cost}}</li>{{/each}}</ul>',
      controls: [{ type: 'sort' as const, field: 'rows', columns: ['cost'], default: 'cost desc' }],
    };
    const out = String(renderOutputWidget(schema, data, 'a', {}) ?? '');
    expect(rowsFromHtml(out)).toEqual(['a|$711.63', 'b|$12.54', 'c|$2.89']);
  });

  it('sorts percent-suffixed numeric strings as numbers', () => {
    const data = JSON.stringify({
      rows: [
        { name: 'a', pct: '5%' },
        { name: 'b', pct: '95%' },
        { name: 'c', pct: '25%' },
      ],
    });
    const schema = {
      type: 'ai-template' as const,
      template: '<ul>{{#each outputs.rows as r}}<li>{{r.name}}|{{r.pct}}</li>{{/each}}</ul>',
      controls: [{ type: 'sort' as const, field: 'rows', columns: ['pct'], default: 'pct asc' }],
    };
    const out = String(renderOutputWidget(schema, data, 'a', {}) ?? '');
    expect(rowsFromHtml(out)).toEqual(['a|5%', 'c|25%', 'b|95%']);
  });

  it('treats comma-separated numbers (`$1,234.56`) as numeric', () => {
    const data = JSON.stringify({
      rows: [
        { name: 'a', cost: '$1,234.56' },
        { name: 'b', cost: '$999.99' },
        { name: 'c', cost: '$50.00' },
      ],
    });
    const schema = {
      type: 'ai-template' as const,
      template: '<ul>{{#each outputs.rows as r}}<li>{{r.name}}</li>{{/each}}</ul>',
      controls: [{ type: 'sort' as const, field: 'rows', columns: ['cost'], default: 'cost asc' }],
    };
    const out = String(renderOutputWidget(schema, data, 'a', {}) ?? '');
    expect(rowsFromHtml(out)).toEqual(['c', 'b', 'a']);
  });
});

describe('renderOutputWidget — table field type (dashboard)', () => {
  const matches = [
    { company: 'Remotecom', title: 'Senior PM', team: 'Product', url: 'https://x/remote' },
    { company: 'Clickhouse', title: 'Senior PM - Cloud', team: 'Product', url: 'https://x/click' },
    { company: 'Gitlab', title: 'Senior PM, Scale', team: 'Platforms', url: '' },
  ];
  const output = JSON.stringify({ headline: '3 matches', matches });

  const baseSchema = {
    type: 'dashboard' as const,
    fields: [
      { name: 'headline', type: 'metric' as const, label: 'Headline' },
      {
        name: 'matches',
        type: 'table' as const,
        label: 'Job matches',
        columns: [
          { name: 'company', label: 'Company' },
          { name: 'title', label: 'Title' },
          { name: 'team', label: 'Team' },
          { name: 'url', label: 'Apply', format: 'link' as const, href: 'url', text: 'Apply →' },
        ],
      },
    ],
  };

  function bodyTexts(html: string): string[] {
    // Pull tbody-only cells so we don't pick up the column headers.
    const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
    if (!tbody) return [];
    return [...tbody[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim());
  }

  it('renders a row per item with column-driven cells', () => {
    const out = String(renderOutputWidget(baseSchema, output, 'a') ?? '');
    expect(out).toContain('<th'); // header row present
    expect(out).toContain('>Company<');
    expect(out).toContain('>Title<');
    // Per-row cells: company / title / team are escaped text, last column is a link.
    const cells = bodyTexts(out);
    expect(cells.slice(0, 4)).toEqual([
      'Remotecom', 'Senior PM', 'Product',
      '<a href="https://x/remote" target="_blank" rel="noopener">Apply →</a>',
    ]);
  });

  it('renders the literal link text when no row carries the named text key', () => {
    // `text: "Apply →"` is a literal because no row has an "Apply →" key.
    const out = String(renderOutputWidget(baseSchema, output, 'a') ?? '');
    expect(out).toContain('>Apply →</a>');
  });

  it('uses a per-row key for link text when the row supplies it', () => {
    const schema = {
      type: 'dashboard' as const,
      fields: [{
        name: 'rows', type: 'table' as const, columns: [
          { name: 'name', format: 'link' as const, href: 'url', text: 'name' },
        ],
      }],
    };
    const out = String(renderOutputWidget(schema, JSON.stringify({
      rows: [{ name: 'Acme', url: 'https://acme/' }],
    }), 'a') ?? '');
    expect(out).toContain('<a href="https://acme/" target="_blank" rel="noopener">Acme</a>');
  });

  it('falls back to plain text when href is missing on a row', () => {
    const out = String(renderOutputWidget(baseSchema, output, 'a') ?? '');
    // Row 3 has url: '' — the last cell should be plain "Apply →" without an <a>.
    expect(out).toMatch(/Gitlab[\s\S]*?Senior PM, Scale[\s\S]*?Platforms[\s\S]*?<td[^>]*>Apply →<\/td>/);
  });

  it('renders header row + empty-state caption when the array is missing or empty', () => {
    const out = String(renderOutputWidget(baseSchema, '{"headline":"none"}', 'a') ?? '');
    expect(out).toContain('>Company<'); // header still visible
    expect(out).toContain('No rows.');
  });

  it('shares sort/filter/paginate controls with the field by name', () => {
    const schema = {
      ...baseSchema,
      controls: [
        { type: 'sort' as const, field: 'matches', columns: ['company', 'title'], default: 'company asc' },
        { type: 'filter' as const, field: 'matches', columns: ['company'] },
      ],
    };
    const sorted = String(renderOutputWidget(schema, output, 'a', {}) ?? '');
    const cells = bodyTexts(sorted);
    // First column of each row should now be sorted: Clickhouse, Gitlab, Remotecom.
    expect([cells[0], cells[4], cells[8]]).toEqual(['Clickhouse', 'Gitlab', 'Remotecom']);

    const filtered = String(renderOutputWidget(schema, output, 'a', {
      filter: new Map([['matches', 'gitlab']]),
    }) ?? '');
    const fcells = bodyTexts(filtered);
    expect(fcells[0]).toBe('Gitlab');
    // Only one row in the filtered set.
    expect(fcells.length / 4).toBe(1);
  });

  it('escapes raw HTML in cell values', () => {
    const out = String(renderOutputWidget({
      type: 'dashboard' as const,
      fields: [{
        name: 'rows', type: 'table' as const, columns: [{ name: 'name' }],
      }],
    }, JSON.stringify({ rows: [{ name: '<script>alert(1)</script>' }] }), 'a') ?? '');
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
  });
});

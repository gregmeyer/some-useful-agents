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
      sort: { column: 'name', direction: 'asc' },
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
    const out = String(renderOutputWidget(schema, output, 'a', { filter: 'TA' }) ?? '');
    // "alpha" (no), "beta" (yes — has "ta"... wait no — "beta" has "ta"? yes "be-TA"),
    // "gamma" no, "delta" yes "del-TA", "epsilon" no.
    expect(rowsFromHtml(out)).toEqual(['beta|50', 'delta|75']);
  });

  it('paginate: slices the array and reports page info', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'paginate' as const, field: 'rows', pageSize: 2 }],
    };
    const page2 = String(renderOutputWidget(schema, output, 'a', { page: 2 }) ?? '');
    expect(rowsFromHtml(page2)).toEqual(['gamma|200', 'delta|75']);
    expect(page2).toContain('page 2 of 3');
    expect(page2).toContain('5 rows');
    // Prev is a real link on page 2, next is too.
    expect(page2.match(/data-widget-control="paginate-prev"/g)).toHaveLength(1);
    expect(page2.match(/data-widget-control="paginate-next"/g)).toHaveLength(1);
  });

  it('paginate: prev disabled on page 1, next disabled on last page', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'paginate' as const, field: 'rows', pageSize: 2 }],
    };
    const page1 = String(renderOutputWidget(schema, output, 'a', { page: 1 }) ?? '');
    expect(page1).not.toContain('data-widget-control="paginate-prev"');
    expect(page1).toContain('data-widget-control="paginate-next"');
    const page3 = String(renderOutputWidget(schema, output, 'a', { page: 3 }) ?? '');
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
    // Filter "a" matches alpha (100), beta (50)? no — "beta" doesn't contain "a"... wait
    // beta = b-e-t-a — yes it contains "a". Let me list:
    // alpha (a) ✓, beta (a) ✓, gamma (a) ✓, delta (a) ✓, epsilon — no "a". So filter
    // keeps 4 rows. Sort by cost asc: beta(50), delta(75), alpha(100), gamma(200).
    // Page 2 of size 2: [alpha, gamma].
    const out = String(renderOutputWidget(schema, output, 'agent', {
      filter: 'a',
      sort: { column: 'cost', direction: 'asc' },
      page: 2,
    }) ?? '');
    expect(rowsFromHtml(out)).toEqual(['alpha|100', 'gamma|200']);
    expect(out).toContain('page 2 of 2');
    expect(out).toContain('4 rows');
  });

  it('clamps page to the valid range and stable-sorts when controls operate on a non-array (no-op)', () => {
    const schema = {
      type: 'ai-template' as const,
      template: baseTemplate,
      controls: [{ type: 'paginate' as const, field: 'rows', pageSize: 2 }],
    };
    // Page 99 → clamps to last (3); also exercises the non-array safety: if the
    // underlying field isn't an array, controls just no-op without throwing.
    const out = String(renderOutputWidget(schema, output, 'a', { page: 99 }) ?? '');
    expect(out).toContain('page 3 of 3');
    const noArr = String(renderOutputWidget(schema, '{"rows":"not an array"}', 'a', { page: 1 }) ?? '');
    // Widget still renders, just without paged content; control row shows page —.
    expect(noArr).toContain('page —');
  });
});

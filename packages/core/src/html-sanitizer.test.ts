import { describe, it, expect } from 'vitest';
import { sanitizeHtml, substitutePlaceholders } from './html-sanitizer.js';

describe('sanitizeHtml', () => {
  it('preserves allowed tags and attributes', () => {
    const out = sanitizeHtml('<div class="card"><h2>Title</h2><p>Body</p></div>');
    expect(out).toBe('<div class="card"><h2>Title</h2><p>Body</p></div>');
  });

  it('strips <script> entirely', () => {
    const out = sanitizeHtml('<div>ok</div><script>alert(1)</script><p>after</p>');
    expect(out).toContain('<div');
    expect(out).toContain('<p');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('strips iframe / object / embed / link / form', () => {
    for (const tag of ['iframe', 'object', 'embed', 'link', 'form']) {
      const out = sanitizeHtml(`<${tag}>x</${tag}><p>safe</p>`);
      expect(out.toLowerCase()).not.toContain(`<${tag}`);
      expect(out).toContain('<p');
    }
  });

  it('strips on* event handlers', () => {
    const out = sanitizeHtml('<div onclick="alert(1)" onmouseover="x()">hi</div>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onmouseover');
    expect(out).toContain('<div');
  });

  it('drops javascript: in href and src', () => {
    const out1 = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out1).not.toContain('javascript');
    const out2 = sanitizeHtml('<img src="javascript:bad">');
    expect(out2).not.toContain('javascript');
  });

  it('allows http(s) and data:image/ in URL attrs', () => {
    expect(sanitizeHtml('<img src="https://example.com/a.png">')).toContain('src="https://example.com/a.png"');
    expect(sanitizeHtml('<img src="data:image/png;base64,xxx">')).toContain('data:image/png');
  });

  it('drops data: URLs that are not image/*', () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>x</script>">x</a>');
    expect(out).not.toContain('data:text/html');
  });

  it('strips javascript: from inline style', () => {
    const out = sanitizeHtml('<div style="background: url(javascript:alert(1)); color: red;">x</div>');
    expect(out).not.toContain('javascript');
    expect(out).toContain('color: red');
  });

  it('preserves SVG with allowed attributes', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="red"/></svg>';
    const out = sanitizeHtml(svg);
    expect(out).toContain('<svg');
    expect(out).toContain('viewBox="0 0 10 10"');
    expect(out).toContain('<path');
    expect(out).toContain('stroke="red"');
  });

  it('drops unknown tags but keeps inner text', () => {
    const out = sanitizeHtml('<custom-thing>kept text</custom-thing>');
    expect(out).not.toContain('custom-thing');
    expect(out).toContain('kept text');
  });

  it('strips HTML comments', () => {
    const out = sanitizeHtml('<!-- evil --><p>ok</p>');
    expect(out).not.toContain('<!--');
    expect(out).toContain('<p');
  });
});

describe('substitutePlaceholders', () => {
  it('replaces {{outputs.NAME}} with HTML-escaped values', () => {
    const t = '<p>Hello {{outputs.name}}</p>';
    const out = substitutePlaceholders(t, { outputs: { name: 'World <b>!' } });
    expect(out).toBe('<p>Hello World &lt;b&gt;!</p>');
  });

  it('replaces {{result}}', () => {
    const out = substitutePlaceholders('<pre>{{result}}</pre>', { result: 'hi & bye' });
    expect(out).toBe('<pre>hi &amp; bye</pre>');
  });

  it('substitutes missing keys with empty string', () => {
    const out = substitutePlaceholders('<p>{{outputs.missing}}</p>', { outputs: {} });
    expect(out).toBe('<p></p>');
  });

  it('handles repeated placeholders', () => {
    const out = substitutePlaceholders('{{outputs.x}}-{{outputs.x}}', { outputs: { x: '1' } });
    expect(out).toBe('1-1');
  });

  it('does not allow injection through values', () => {
    const out = substitutePlaceholders(
      '<p>{{outputs.x}}</p>',
      { outputs: { x: '<script>alert(1)</script>' } },
    );
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  // ── D.5: triple-brace unescaped substitution ──────────────────────────

  it('triple-brace {{{outputs.X}}} substitutes without HTML-escaping', () => {
    const out = substitutePlaceholders(
      '<div>{{{outputs.html}}}</div>',
      { outputs: { html: '<strong>bold</strong>' } },
    );
    expect(out).toBe('<div><strong>bold</strong></div>');
  });

  it('triple-brace {{{result}}} substitutes raw result', () => {
    const out = substitutePlaceholders('<div>{{{result}}}</div>', { result: '<em>hi</em>' });
    expect(out).toBe('<div><em>hi</em></div>');
  });

  it('triple-brace and double-brace can coexist in the same template', () => {
    const out = substitutePlaceholders(
      '{{{outputs.html}}} | {{outputs.text}}',
      { outputs: { html: '<b>x</b>', text: '<b>y</b>' } },
    );
    expect(out).toBe('<b>x</b> | &lt;b&gt;y&lt;/b&gt;');
  });

  it('sanitizer still catches script when run after triple-brace substitution', () => {
    // Caller is required to run sanitizeHtml after substitutePlaceholders;
    // verify the defense-in-depth pass works.
    const subbed = substitutePlaceholders(
      '<div>{{{outputs.x}}}</div>',
      { outputs: { x: '<p>ok</p><script>bad</script>' } },
    );
    const safe = sanitizeHtml(subbed);
    expect(safe).toContain('<p>ok</p>');
    expect(safe).not.toContain('<script>');
  });

  it('triple-brace handles non-string values by JSON-stringifying', () => {
    const out = substitutePlaceholders(
      '{{{outputs.obj}}}',
      { outputs: { obj: { a: 1 } } },
    );
    expect(out).toBe('{"a":1}');
  });

  // ── D.5: {{#each}} iteration ──────────────────────────────────────────

  it('iterates an array with {{#each X as item}} and {{item.field}}', () => {
    const t = '<ul>{{#each outputs.items as item}}<li>{{item.title}}</li>{{/each}}</ul>';
    const out = substitutePlaceholders(t, {
      outputs: { items: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] },
    });
    expect(out).toBe('<ul><li>a</li><li>b</li><li>c</li></ul>');
  });

  it('iteration escapes {{item.field}} but not {{{item.field}}}', () => {
    const t = '{{#each outputs.x as item}}E:{{item.v}}|U:{{{item.v}}}|{{/each}}';
    const out = substitutePlaceholders(t, {
      outputs: { x: [{ v: '<b>' }] },
    });
    expect(out).toBe('E:&lt;b&gt;|U:<b>|');
  });

  it('iteration exposes {{@index}}', () => {
    const t = '{{#each outputs.x as item}}[{{@index}}:{{item.n}}]{{/each}}';
    const out = substitutePlaceholders(t, {
      outputs: { x: [{ n: 'a' }, { n: 'b' }] },
    });
    expect(out).toBe('[0:a][1:b]');
  });

  it('iteration on non-array renders empty', () => {
    const t = 'before:{{#each outputs.x as item}}{{item.y}}{{/each}}:after';
    expect(substitutePlaceholders(t, { outputs: { x: 'not an array' } })).toBe('before::after');
    expect(substitutePlaceholders(t, { outputs: {} })).toBe('before::after');
    expect(substitutePlaceholders(t, { outputs: { x: null } })).toBe('before::after');
  });

  it('iteration on empty array renders empty body', () => {
    const t = 'before:{{#each outputs.x as item}}{{item.y}}{{/each}}:after';
    expect(substitutePlaceholders(t, { outputs: { x: [] } })).toBe('before::after');
  });

  it('iteration body can also reference outer-scope outputs', () => {
    const t = '{{#each outputs.items as item}}<p>{{outputs.title}}: {{item.v}}</p>{{/each}}';
    const out = substitutePlaceholders(t, {
      outputs: { title: 'Hi', items: [{ v: 'a' }, { v: 'b' }] },
    });
    expect(out).toBe('<p>Hi: a</p><p>Hi: b</p>');
  });

  it('item alias scopes correctly — {{outer.field}} is not confused with item alias', () => {
    const t = '{{#each outputs.items as outer}}{{outer.x}}{{/each}}';
    const out = substitutePlaceholders(t, {
      outputs: { items: [{ x: 'A' }, { x: 'B' }] },
    });
    expect(out).toBe('AB');
  });

  it('{{item}} (no field) renders the item as JSON when iterating primitives', () => {
    const t = '{{#each outputs.x as item}}[{{item}}]{{/each}}';
    expect(substitutePlaceholders(t, { outputs: { x: ['a', 'b'] } })).toBe('[a][b]');
    expect(substitutePlaceholders(t, { outputs: { x: [1, 2] } })).toBe('[1][2]');
  });

  it('multiple each blocks render independently', () => {
    const t = 'A:{{#each outputs.a as i}}{{i.v}}{{/each}}|B:{{#each outputs.b as j}}{{j.v}}{{/each}}';
    const out = substitutePlaceholders(t, {
      outputs: { a: [{ v: 'x' }, { v: 'y' }], b: [{ v: '1' }, { v: '2' }] },
    });
    expect(out).toBe('A:xy|B:12');
  });

  describe('#if blocks', () => {
    it('keeps the body when the output is a non-empty string', () => {
      const out = substitutePlaceholders(
        '{{#if outputs.title}}<h1>{{outputs.title}}</h1>{{/if}}',
        { outputs: { title: 'hi' } },
      );
      expect(out).toBe('<h1>hi</h1>');
    });

    it('drops the body for null, undefined, empty string, false, 0, empty array', () => {
      const t = '<p>before</p>{{#if outputs.x}}<p>shown</p>{{/if}}<p>after</p>';
      for (const falsy of [null, undefined, '', false, 0, []] as const) {
        const out = substitutePlaceholders(t, { outputs: { x: falsy as unknown } });
        expect(out).toBe('<p>before</p><p>after</p>');
      }
    });

    it('keeps the body for truthy values: numbers, objects, non-empty arrays', () => {
      for (const truthy of [1, { a: 1 }, ['x'], 'text'] as const) {
        const out = substitutePlaceholders(
          '{{#if outputs.x}}YES{{/if}}',
          { outputs: { x: truthy as unknown } },
        );
        expect(out).toBe('YES');
      }
    });

    it('lets inner placeholders render after the if-body is kept', () => {
      const out = substitutePlaceholders(
        '{{#if outputs.found}}<a href="{{outputs.url}}">{{outputs.title}}</a>{{/if}}',
        { outputs: { found: true, url: 'https://x', title: 'cat' } },
      );
      expect(out).toBe('<a href="https://x">cat</a>');
    });

    it('#unless is the complement of #if', () => {
      // Falsy: keep body. Truthy: drop body. Together with #if these give
      // single-branch if/else without dragging in {{else}} parsing.
      const t = '{{#if outputs.url}}A{{/if}}{{#unless outputs.url}}B{{/unless}}';
      expect(substitutePlaceholders(t, { outputs: { url: 'x' } })).toBe('A');
      expect(substitutePlaceholders(t, { outputs: { url: '' } })).toBe('B');
      expect(substitutePlaceholders(t, { outputs: {} })).toBe('B');
    });

    it('does not match Handlebars helpers like (eq …) — renders as literal', () => {
      // Documents the deliberate non-feature: only {{#if outputs.NAME}} is
      // supported. Helpers must be caught by catalog guidance, not silently
      // partially-evaluated.
      const t = '{{#if (eq outputs.status "found")}}A{{/if}}';
      const out = substitutePlaceholders(t, { outputs: { status: 'found' } });
      expect(out).toBe(t);
    });
  });
});

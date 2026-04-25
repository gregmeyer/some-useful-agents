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
});

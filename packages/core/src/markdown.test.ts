import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderMarkdownSafe, markdownToText } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders bold and italic', () => {
    expect(renderMarkdown('**bold** and *italic*')).toBe('<p><strong>bold</strong> and <em>italic</em></p>');
    expect(renderMarkdown('_em_')).toBe('<p><em>em</em></p>');
  });

  it('renders inline code without reinterpreting markers inside', () => {
    expect(renderMarkdown('use `**not bold**` here')).toBe('<p>use <code>**not bold**</code> here</p>');
  });

  it('renders fenced code blocks with escaped content', () => {
    expect(renderMarkdown('```\n<a> & b\n```')).toBe('<pre><code>&lt;a&gt; &amp; b</code></pre>');
  });

  it('renders headings', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>');
    expect(renderMarkdown('### Three')).toBe('<h3>Three</h3>');
  });

  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
  });

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });

  it('renders horizontal rules', () => {
    expect(renderMarkdown('---')).toBe('<hr>');
  });

  it('renders links', () => {
    expect(renderMarkdown('[agent](/agents/foo)')).toBe('<p><a href="/agents/foo">agent</a></p>');
  });

  it('treats single newlines as soft breaks within a paragraph', () => {
    expect(renderMarkdown('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });

  it('separates paragraphs on blank lines', () => {
    expect(renderMarkdown('para one\n\npara two')).toBe('<p>para one</p>\n<p>para two</p>');
  });

  it('escapes raw HTML in text', () => {
    expect(renderMarkdown('a < b & c')).toBe('<p>a &lt; b &amp; c</p>');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});

describe('renderMarkdownSafe (composition with sanitizer)', () => {
  it('renders a script tag inert (escaped, never an executable tag)', () => {
    const html = renderMarkdownSafe('hello <script>alert(1)</script> world');
    // No live <script> element — the markup is escaped to text.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralizes javascript: links', () => {
    const html = renderMarkdownSafe('[x](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('keeps relative /agents and /runs links', () => {
    const agents = renderMarkdownSafe('[a](/agents/foo)');
    expect(agents).toContain('href="/agents/foo"');
    const runs = renderMarkdownSafe('[r](/runs/abc123)');
    expect(runs).toContain('href="/runs/abc123"');
  });

  it('preserves allowlisted markdown tags through the sanitizer', () => {
    const html = renderMarkdownSafe('**bold** and `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });
});

describe('markdownToText', () => {
  it('strips bold/italic/underscore/code markers, keeping content', () => {
    expect(markdownToText('**bold** and *italic* and _em_ and `code`')).toBe('bold and italic and em and code');
  });

  it('unwraps links to their label', () => {
    expect(markdownToText('open [the agent](/agents/foo) now')).toBe('open the agent now');
  });

  it('unwraps images to their alt text', () => {
    expect(markdownToText('![alt text](/img.png)')).toBe('alt text');
  });

  it('drops heading, list, and blockquote markers', () => {
    expect(markdownToText('# Title')).toBe('Title');
    expect(markdownToText('- a\n- b')).toBe('a b');
    expect(markdownToText('1. one\n2. two')).toBe('one two');
    expect(markdownToText('> quoted')).toBe('quoted');
  });

  it('collapses newlines and whitespace to single spaces', () => {
    expect(markdownToText('line one\n\nline   two')).toBe('line one line two');
  });

  it('keeps fenced code contents without the fences', () => {
    expect(markdownToText('```js\nx()\n```')).toBe('x()');
  });

  it('drops horizontal rules', () => {
    expect(markdownToText('a\n\n---\n\nb')).toBe('a b');
  });

  it('returns empty string for empty input', () => {
    expect(markdownToText('')).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(markdownToText('just a normal sentence.')).toBe('just a normal sentence.');
  });
});

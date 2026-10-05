import { describe, it, expect } from 'vitest';
import { bodyWithLinks } from './notebooks.js';
import { render } from './html.js';

describe('notebook entry links', () => {
  it('turns web addresses into links named for their site, keeping trailing punctuation outside', () => {
    const out = render(bodyWithLinks('Not verified: https://www.cargurus.com/Cars/l-Used-Toyota-RAV4?a=1&b=2. Call <them>'));
    expect(out).toContain('<a href="https://www.cargurus.com/Cars/l-Used-Toyota-RAV4?a=1&amp;b=2" class="nb-entry__link" target="_blank" rel="noopener noreferrer"');
    expect(out).toContain('>cargurus.com ↗</a>.');
    expect(out).toContain('&lt;them&gt;');
  });

  it('links only http(s) addresses', () => {
    expect(render(bodyWithLinks('javascript:alert(1) and ftp://x'))).not.toContain('<a ');
  });
});

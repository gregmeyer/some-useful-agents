import { describe, it, expect } from 'vitest';
import { bodyWithLinks, formatFieldValue } from './notebooks.js';
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

describe('option facts as people read them', () => {
  it('formats money, units, years and ranges', () => {
    const money = { key: 'salary', label: 'Salary', type: 'money' as const, range: true };
    const sqft = { key: 'size', label: 'Size', type: 'number' as const, unit: 'sq ft' };
    expect(formatFieldValue(money, { min: 150000, max: 180000 })).toBe('$150,000–$180,000');
    expect(formatFieldValue(money, { min: 175000, max: 175000 })).toBe('$175,000');
    expect(formatFieldValue({ ...sqft, range: true }, { min: 650, max: 800 })).toBe('650–800 sq ft');
    expect(formatFieldValue(sqft, 720)).toBe('720 sq ft');
    expect(formatFieldValue({ key: 'year', label: 'Year', type: 'number' }, 2010)).toBe('2010');
  });
});

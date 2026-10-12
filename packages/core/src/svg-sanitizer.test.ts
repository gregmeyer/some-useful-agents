import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from './svg-sanitizer.js';

describe('sanitizeSvg', () => {
  it('keeps a plain drawing, with the SVG namespace and proper casing', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 100 60"><defs><linearGradient id="g"><stop offset="0" stop-color="#2dd4bf"/></linearGradient></defs><rect x="0" y="0" width="100" height="60" fill="url(#g)"/><text x="50" y="30" text-anchor="middle">RAV4 &amp; co</text></svg>');
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><defs><linearGradient id="g"><stop offset="0" stop-color="#2dd4bf"/></linearGradient></defs><rect x="0" y="0" width="100" height="60" fill="url(#g)"/><text x="50" y="30" text-anchor="middle">RAV4 &amp; co</text></svg>');
  });

  it('drops everything that could run, load or link', () => {
    const evil = [
      '<svg onload="alert(1)"><circle r="5"/></svg>',
      '<svg><script>alert(1)</script><circle r="5"/></svg>',
      '<svg><foreignObject><iframe src="https://x"></iframe></foreignObject><circle r="5"/></svg>',
      '<svg><image href="https://tracker.example/p.png"/><circle r="5"/></svg>',
      '<svg><a xlink:href="javascript:alert(1)"><rect width="9" height="9"/></a><circle r="5"/></svg>',
      '<svg><style>@import url(https://x/a.css)</style><circle r="5"/></svg>',
      '<svg><rect fill="url(https://x/y#z)" width="5" height="5"/><circle r="5"/></svg>',
      '<svg><use href="#a"/><animate attributeName="href" to="javascript:alert(1)"/><circle r="5"/></svg>',
      '<svg><circle r="5" style="fill:red" xlink:href="x"/></svg>',
      '<svg><set attributeName="onmouseover" to="alert(1)"/><circle r="5"/></svg>',
    ];
    for (const s of evil) {
      const out = sanitizeSvg(s)!;
      expect(out, s).toContain('<circle r="5"');
      expect(out, s).not.toMatch(/script|onload|onmouse|foreign|iframe|<image|xlink|javascript|@import|style|https:|<use|<animate|<set|<a[ >]/i);
    }
  });

  it('nests and closes correctly, and keeps text only where text belongs', () => {
    expect(sanitizeSvg('<svg><g><path d="M0 0L5 5"></g>stray text<text>hi<tspan>!</tspan></text>'))
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0L5 5"></path></g><text>hi<tspan>!</tspan></text></svg>');
  });

  it('refuses no root, a wrong namespace, and anything too big', () => {
    expect(sanitizeSvg('<div>not svg</div>')).toBeUndefined();
    expect(sanitizeSvg('<svg xmlns="http://evil.example/ns"><circle r="1"/></svg>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
    expect(sanitizeSvg(`<svg>${'<circle r="1"/>'.repeat(10000)}</svg>`)).toBeUndefined();
  });
});

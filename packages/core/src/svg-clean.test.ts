import { describe, it, expect } from 'vitest';
import { cleanSvg } from './svg-clean.js';

describe('a drawing made safe to draw', () => {
  it('takes the <svg> out of a reply, with its size', () => {
    const out = cleanSvg('Here it is:\n<svg width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#fef3c7"/></svg>\nDone.');
    expect(out).toEqual({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#fef3c7"/></svg>', width: 800, height: 500 });
    expect(cleanSvg('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 1600 1000"></svg>')).toMatchObject({ width: 1600, height: 1000 });
  });

  it('removes code, handlers, embedded pages and anything it would fetch; keeps links within it and inline pictures', () => {
    const out = cleanSvg(`<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><foreignObject><div>hi</div></foreignObject>
      <style>@import url(https://evil.example/a.css); .a{fill:url(#g)} .b{background:url(https://evil.example/p.png)}</style>
      <use href="#bread"/><image href="https://evil.example/p.png"/><image xlink:href="data:image/png;base64,iVBORw0KGgo="/><rect onclick="y()" fill="url(#g)"/></svg>`);
    if ('error' in out) throw new Error(out.error);
    expect(out.svg).not.toMatch(/script|foreignObject|onload|onclick|evil\.example|@import/);
    expect(out.svg).toContain('<use href="#bread"/>');
    expect(out.svg).toContain('xlink:href="data:image/png;base64,iVBORw0KGgo="');
    expect(out.svg).toContain('fill:url(#g)');
  });

  it('refuses no drawing, no size, javascript: and one too big', () => {
    expect(cleanSvg('no drawing here')).toEqual({ error: 'There is no <svg> drawing in it.' });
    expect(cleanSvg('<svg><rect/></svg>')).toMatchObject({ error: expect.stringContaining('no size') });
    expect(cleanSvg('<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"/><set to="javascript:x"/></svg>')).toMatchObject({ error: 'The drawing has code in it.' });
    expect(cleanSvg(`<svg viewBox="0 0 1 1">${'x'.repeat(400_001)}</svg>`)).toMatchObject({ error: expect.stringContaining('too big') });
  });
});

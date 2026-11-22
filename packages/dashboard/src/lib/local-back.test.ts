import { describe, it, expect } from 'vitest';
import { localBack } from './local-back.js';

describe('localBack', () => {
  it('keeps a path on this dashboard, with its query', () => {
    expect(localBack('/notebooks?sort=title&page=2')).toBe('/notebooks?sort=title&page=2');
    expect(localBack('/agents')).toBe('/agents');
  });
  it('refuses anything that could leave the site, or isn’t a path', () => {
    for (const v of ['//evil.example', '/\\evil.example', 'https://evil.example/', 'notebooks', '/a b', '', undefined, 3, `/${'x'.repeat(600)}`]) {
      expect(localBack(v)).toBeUndefined();
    }
  });
});

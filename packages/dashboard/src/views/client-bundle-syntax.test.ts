import { describe, it, expect } from 'vitest';
import { CLIENT_BUNDLE_JS } from './client-bundle.js';
import { NOTEBOOK_PAGE_JS } from './notebook-page.js.js';

// Every page loads this one script: a syntax error in any part stops all of
// them (widgets, the sua drawer). Compile it (without running it).
describe('the client bundle', () => {
  it('parses', () => {
    expect(() => new Function(NOTEBOOK_PAGE_JS)).not.toThrow();
    expect(() => new Function(CLIENT_BUNDLE_JS)).not.toThrow();
  });
});

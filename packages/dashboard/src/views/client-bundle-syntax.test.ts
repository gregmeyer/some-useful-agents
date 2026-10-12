import { describe, it, expect } from 'vitest';
import { CLIENT_BUNDLE_JS } from './client-bundle.js';
import { NOTEBOOK_PAGE_JS } from './notebook-page.js.js';
import { GRAPH_RENDER_JS } from '../routes/assets.js';

// Every page loads this one script: a syntax error in any part stops all of
// them (widgets, the sua drawer). Compile it (without running it).
describe('the client bundle', () => {
  it('parses', () => {
    expect(() => new Function(NOTEBOOK_PAGE_JS)).not.toThrow();
    expect(() => new Function(CLIENT_BUNDLE_JS)).not.toThrow();
  });

  // The agent diagram's script lives in a template string too, where a "\n"
  // that should stay an escape becomes a real line break and blanks every DAG.
  it('includes a diagram script that parses', () => {
    expect(() => new Function(GRAPH_RENDER_JS)).not.toThrow();
  });
});

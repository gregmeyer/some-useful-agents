import { describe, it, expect } from 'vitest';
import { INBOX_STREAM_JS } from './inbox-stream.js.js';

describe('INBOX_STREAM_JS', () => {
  it('opens the global inbox SSE stream', () => {
    expect(INBOX_STREAM_JS).toContain("new EventSource('/inbox/events')");
  });

  // Regression: without a deterministic close on navigation, rapid page-to-page
  // clicks stack not-yet-reaped SSE sockets against the ~6-per-origin HTTP/1.1
  // cap and later requests queue behind them, slowing the dashboard. The stream
  // must release its connection on pagehide.
  it('closes the stream on pagehide to free the connection slot', () => {
    expect(INBOX_STREAM_JS).toContain("addEventListener('pagehide'");
    expect(INBOX_STREAM_JS).toContain('es.close()');
  });
});

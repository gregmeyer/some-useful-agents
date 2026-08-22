/**
 * The client session guard, executed as the string we actually ship.
 *
 * There is no DOM environment in this suite, so the test stubs the handful of
 * globals the guard touches and runs the real source through `new Function`.
 * That is deliberate: the guard's whole job is to notice a 401 that no other
 * code was noticing, and a reimplementation in the test would prove nothing
 * about the string that reaches the browser. It also catches a syntax error in
 * the template — which would otherwise only surface as a silently dead bundle.
 */

import { describe, it, expect } from 'vitest';
import { SESSION_GUARD_JS } from './session-guard.js.js';

interface FakeEl {
  id: string;
  className: string;
  innerHTML: string;
  setAttribute: (k: string, v: string) => void;
}

interface Harness {
  /** Run a fetch through the guard's wrapper and resolve with the given status. */
  callFetch: (url: string, status: number) => Promise<unknown>;
  banner: () => FakeEl | undefined;
  events: string[];
  /** Fire the 60s heartbeat without waiting for it. */
  tick: () => void;
}

/**
 * Execute the shipped guard against stub globals. Only what the guard actually
 * uses is stubbed; anything else it reached for would throw and fail the test,
 * which is the behavior we want.
 */
function run(origin = 'http://127.0.0.1:3000'): Harness {
  const children: FakeEl[] = [];
  const events: string[] = [];
  let intervalFn: (() => void) | undefined;
  let nextStatus = 200;
  let lastUrl = '';

  const doc = {
    getElementById: (id: string) => children.find((c) => c.id === id),
    createElement: (): FakeEl => ({
      id: '', className: '', innerHTML: '', setAttribute() { /* noop */ },
    }),
    body: { appendChild: (el: FakeEl) => { children.push(el); } },
  };

  const win: Record<string, unknown> = {
    location: { href: `${origin}/agents`, origin },
    // The guard wraps whatever fetch it finds; this stand-in echoes back the
    // status the test asked for, at the URL the test asked for.
    fetch: (input: unknown) => {
      lastUrl = String(input);
      const abs = new URL(lastUrl, `${origin}/`).toString();
      return Promise.resolve({ status: nextStatus, url: abs });
    },
    dispatchEvent: (e: { type: string }) => { events.push(e.type); return true; },
    CustomEvent: class { type: string; constructor(t: string) { this.type = t; } },
    URL,
    setInterval: (fn: () => void) => { intervalFn = fn; return 1; },
  };

  new Function('window', 'document', SESSION_GUARD_JS)(win, doc);

  return {
    callFetch: (url, status) => {
      nextStatus = status;
      return (win.fetch as (u: string) => Promise<unknown>)(url);
    },
    banner: () => children.find((c) => c.id === 'sua-session-banner'),
    events,
    tick: () => intervalFn?.(),
  };
}

describe('client session guard', () => {
  it('does nothing while requests are succeeding', async () => {
    const h = run();
    await h.callFetch('/inbox/needs-you-count', 200);
    expect(h.banner()).toBeUndefined();
    expect(h.events).toEqual([]);
  });

  it('announces a sign-out when a same-origin request 401s', async () => {
    const h = run();
    await h.callFetch('/inbox/needs-you-count', 401);
    const banner = h.banner();
    expect(banner).toBeDefined();
    expect(banner!.innerHTML).toContain('signed out');
    // The banner has to offer a way back, not just state the problem.
    expect(banner!.innerHTML).toContain('/auth?expired=1');
    expect(h.events).toContain('sua:signed-out');
  });

  it('ignores a 401 from somewhere else entirely', async () => {
    // Agent widgets fetch third-party URLs. One of those returning 401 says
    // nothing about the operator's dashboard session, and telling them they
    // were signed out when they were not is its own failure.
    const h = run();
    await h.callFetch('https://api.example.com/private', 401);
    expect(h.banner()).toBeUndefined();
    expect(h.events).toEqual([]);
  });

  it('only announces once, however many requests fail', async () => {
    const h = run();
    await h.callFetch('/a', 401);
    await h.callFetch('/b', 401);
    await h.callFetch('/c', 401);
    expect(h.events).toEqual(['sua:signed-out']);
  });

  it('still returns the response so callers behave normally', async () => {
    const h = run();
    const res = (await h.callFetch('/x', 401)) as { status: number };
    expect(res.status).toBe(401);
  });

  it('heartbeats so an idle page notices too', async () => {
    // A page that issues no other requests would otherwise learn nothing
    // until the operator clicked something and it silently failed.
    const h = run();
    h.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.banner()).toBeUndefined(); // 200 by default — no false alarm
  });
});

/**
 * The landing page has to orient a newcomer.
 *
 * For any real install `/` rendered ONLY the inbox cadence feed — no title, no
 * explanation of what sua is, and no route to `/start` or the tutorial anywhere
 * in the body. On a quiet day the whole page was one dim line. The zero-agent
 * branch does have that orientation, but it cannot render on a normal install
 * because `sua init` installs ~40 agents, so in practice nobody ever saw it:
 * the shortest real path to `/start` was `/` → Help → scroll → card, three
 * clicks deep.
 */

import { describe, it, expect } from 'vitest';
import { pageIntro } from './page-intro.js';

describe('pageIntro', () => {
  it('renders nothing extra when no actions are given', () => {
    const out = pageIntro({ key: 'k', text: 'hello' }).toString();
    expect(out).toContain('hello');
    expect(out).not.toContain('page-intro__actions');
  });

  it('keeps an off-site learn-more opening in a new tab', () => {
    const out = pageIntro({
      key: 'k', text: 't',
      learnMore: { href: 'https://github.com/x/y', label: 'Docs' },
    }).toString();
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener"');
  });

  it('does not send the reader out of the app for an in-product link', () => {
    // This used to force target=_blank unconditionally — right for the single
    // GitHub-docs caller, wrong the moment home linked to /help.
    const out = pageIntro({ key: 'k', text: 't', learnMore: { href: '/help' } }).toString();
    expect(out).toContain('href="/help"');
    expect(out).not.toContain('target="_blank"');
  });
});

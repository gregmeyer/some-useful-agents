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
import { renderHomePage } from './home.js';
import { pageIntro } from './page-intro.js';

type Input = Parameters<typeof renderHomePage>[0];

const emptyFeed = { needsYou: [], today: [], week: [], earlier: [], closed: [] };

function home(over: Partial<Input> = {}): string {
  return renderHomePage({
    agentCount: 40,
    feed: emptyFeed,
    ...over,
  } as Input);
}

describe('home orientation', () => {
  it('puts Start here and the tutorial one click from the landing page', () => {
    const out = home();
    expect(out).toContain('href="/start"');
    expect(out).toContain('href="/help/tutorial"');
  });

  it('says what sua is, rather than leaving the page unexplained', () => {
    const out = home();
    expect(out).toContain('page-intro');
    expect(out).toContain('run here, on this machine');
    // A way to the longer explanation that already exists on /help.
    expect(out).toContain('What is sua?');
  });

  it('is dismissible, so it does not nag a daily user', () => {
    // Onboarding chrome should have onboarding lifetime. Keyed for the
    // existing PAGE_INTRO_JS localStorage handler.
    expect(home()).toContain('data-intro-key="home"');
    expect(home()).toContain('data-intro-dismiss');
  });

  it('still leads with the feed — orientation sits above it, not instead of it', () => {
    const out = home();
    expect(out).toContain('home-inbox');
    expect(out.indexOf('page-intro')).toBeLessThan(out.indexOf('home-inbox'));
  });

  it('leaves the zero-agent onboarding state alone', () => {
    // That branch already orients the reader and has its own three CTAs;
    // it just never renders on a real install.
    const out = home({ agentCount: 0 });
    expect(out).toContain('No agents yet');
    expect(out).not.toContain('data-intro-key="home"');
  });
});

/**
 * `pageIntro` gained optional next-step buttons for the home page. Two things
 * are worth pinning: the buttons are additive (the one existing caller must be
 * unchanged), and an in-product link no longer opens in a new tab.
 */
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

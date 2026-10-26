import { describe, it, expect } from 'vitest';
import { pageIntro } from './page-intro.js';
import { render } from './html.js';

describe('pageIntro', () => {
  it('renders the key, text, and a dismiss button', () => {
    const out = render(pageIntro({ key: 'pulse', text: 'Live radiator of agent output.' }));
    expect(out).toContain('class="page-intro"');
    expect(out).toContain('data-intro-key="pulse"');
    expect(out).toContain('Live radiator of agent output.');
    expect(out).toContain('data-intro-dismiss');
    expect(out).toContain('Got it');
  });

  it('omits the link when no learnMore is given', () => {
    const out = render(pageIntro({ key: 'home', text: 'hi' }));
    expect(out).not.toContain('page-intro__link');
  });

  it('renders a learnMore link with a default label and noopener', () => {
    const out = render(pageIntro({ key: 'home', text: 'hi', learnMore: { href: 'https://example.com/docs' } }));
    expect(out).toContain('href="https://example.com/docs"');
    expect(out).toContain('rel="noopener"');
    expect(out).toContain('target="_blank"'); // off-site: a new tab
    expect(out).toContain('Learn more');
  });

  it('keeps the reader in the app for an in-product link', () => {
    // This used to force target=_blank unconditionally — right for the single
    // GitHub-docs caller, wrong the moment Home linked to /help.
    const out = render(pageIntro({ key: 'home', text: 't', learnMore: { href: '/help' } }));
    expect(out).toContain('href="/help"');
    expect(out).not.toContain('target="_blank"');
  });

  it('honors a custom learnMore label', () => {
    const out = render(pageIntro({ key: 'home', text: 'hi', learnMore: { href: 'https://example.com', label: 'Dashboard tour' } }));
    expect(out).toContain('Dashboard tour');
  });

  it('escapes the text (no raw HTML injection)', () => {
    const out = render(pageIntro({ key: 'x', text: '<script>alert(1)</script>' }));
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

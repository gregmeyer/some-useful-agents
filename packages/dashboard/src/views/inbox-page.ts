import type { AutonomyMode } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageIntro } from './page-intro.js';
import { buildFromGoalButton, buildFromGoalModal } from './build-from-goal-modal.js';

/**
 * Home: your inbox on one canvas (conversations phase 3b). `/`, `/inbox`
 * and `/inbox/:id` all render this. The list and the thread sit side by
 * side; inbox-modal.js.ts moves the shared thread view into
 * `[data-inbox-split]` (its "page" mode), so the panel on other pages and
 * this page are the same thing at two widths.
 *
 * The top of the page is a placeholder for the Home surface
 * (~/.claude/plans/goal-surfaces.md, S3): what needs you and what changed,
 * organized by what you're trying to do rather than by agent.
 */
export function renderInboxPage(opts: {
  autonomyMode: AutonomyMode;
  threadId?: string;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  /** With no agents yet, Home is onboarding instead (an empty inbox teaches nothing). */
  agentCount?: number;
  availableDashboards?: Array<{ id: string; name: string }>;
}): string {
  if (opts.agentCount === 0 && !opts.threadId) {
    return render(layout({ title: 'Home', activeNav: 'inbox', flash: opts.flash }, html`
      <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
        <h1 style="margin: 0;">Home</h1>
        <span class="dim" style="font-size: var(--font-size-sm);">0 agents registered</span>
      </div>
      <div class="settings-empty" style="margin-top: var(--space-4);">
        <h3 style="margin-top: 0;">No agents yet</h3>
        <p class="dim">An agent is a named task sua can run: a shell command, an LLM prompt, or a chain of both. <strong>↑ Describe what you want in the <span class="mono">sua ›</span> bar above and sua will build it</strong>, or use the guided builder.</p>
        <p style="display: flex; gap: var(--space-3); justify-content: center; margin: 0;">
          <a class="btn btn--primary" href="/start">Start here</a>
          ${buildFromGoalButton({ variant: 'ghost' })}
          <a class="btn" href="/help/tutorial">Open tutorial</a>
        </p>
      </div>
      ${buildFromGoalModal({ availableDashboards: opts.availableDashboards })}
    `));
  }
  return render(layout({ title: 'Inbox', activeNav: 'inbox', flash: opts.flash, wide: true }, html`
    <div class="inbox-page-head">
      <div>
        <h1 style="margin: 0; font-family: var(--font-mono); font-size: var(--font-size-xl);">Inbox</h1>
        <p class="dim" style="margin: var(--space-1) 0 0; font-size: var(--font-size-sm);">
          Everything sua and your agents need from you, and every conversation. Pick one to read and reply; Ask sua (⌘K) brings this beside any page.
        </p>
      </div>
    </div>
    ${pageIntro({
      key: 'home',
      text: 'Your agents run here, on this machine. This page is what needs your attention, and every conversation with sua.',
      learnMore: { href: '/help', label: 'What is sua?' },
      actions: [
        { href: '/start', label: 'Start here', primary: true },
        { href: '/help/tutorial', label: 'Tutorial' },
      ],
    })}
    ${renderAutonomyControl(opts.autonomyMode)}
    <div class="inbox-split" data-inbox-split data-initial-thread="${opts.threadId ?? ''}">
      <noscript><p class="dim">The inbox needs JavaScript.</p></noscript>
    </div>
  `));
}

/** How much sua may do on its own (POST /inbox/trust/mode). */
export function renderAutonomyControl(mode: AutonomyMode): SafeHtml {
  const seg = (value: AutonomyMode, label: string): SafeHtml => html`
    <form method="POST" action="/inbox/trust/mode" style="margin: 0;">
      <input type="hidden" name="mode" value="${value}">
      <button type="submit" class="inbox-autonomy__seg ${mode === value ? 'inbox-autonomy__seg--active' : ''}"
        ${mode === value ? 'aria-current="true"' : ''}>${label}</button>
    </form>
  `;
  const caption = mode === 'off'
    ? 'Paused — new items are not auto-triaged and no actions auto-run.'
    : mode === 'propose-only'
      ? 'Triage still analyzes new items, but every action waits for your approval.'
      : 'Trusted agents run automatically; others wait for your approval.';
  const dotClass = mode === 'off' ? 'inbox-autonomy__dot--off' : mode === 'propose-only' ? 'inbox-autonomy__dot--warn' : 'inbox-autonomy__dot--on';
  return html`
    <div class="inbox-autonomy" role="group" aria-label="Autonomy mode">
      <span class="inbox-autonomy__label">
        <span class="inbox-autonomy__dot ${dotClass}" aria-hidden="true"></span>Autonomy
      </span>
      <div class="inbox-autonomy__segs">
        ${seg('full', 'Full')}
        ${seg('propose-only', 'Approve first')}
        ${seg('off', 'Off')}
      </div>
      <span class="inbox-autonomy__caption dim">${caption}</span>
    </div>
  `;
}

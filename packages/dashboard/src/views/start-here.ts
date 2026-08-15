import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { sectionTabs } from './section-tabs.js';
import { miniDag, describeDag, type MiniDagNode } from './mini-dag.js';

export interface StarterCard {
  id: string;
  name: string;
  description?: string;
  scheduled: boolean;
  nodeCount: number;
  shape: MiniDagNode[];
  parallel: boolean;
  tools: string[];
  inputs: string[];
}

export interface StartHereArgs {
  starters: StarterCard[];
  /** How many example agents are installed in total (the "explore all" count). */
  exampleCount: number;
  /** True when the starters pack isn't registered — degrade, don't 500. */
  packMissing?: boolean;
  /** Success banner, e.g. handed over from the Connect-a-model redirect. */
  flash?: string;
}

/** One line per starter explaining the *pattern*, not the agent. */
const PATTERN: Record<string, { ord: string; label: string; teaches: string }> = {
  'starter-research': {
    ord: '01',
    label: 'Ask',
    teaches: 'You give it a goal, not a URL. It decides what to open.',
  },
  'starter-watch': {
    ord: '02',
    label: 'Watch',
    teaches: 'Same agent, on a clock. It runs when you are not here.',
  },
  'starter-draft': {
    ord: '03',
    label: 'Produce',
    teaches: 'The output is the deliverable, not a summary of one.',
  },
};

export function renderStartHerePage(args: StartHereArgs): string {
  const cards = args.starters.map((s, i) => {
    const pattern = PATTERN[s.id] ?? {
      ord: String(i + 1).padStart(2, '0'),
      label: 'Pattern',
      teaches: '',
    };
    return html`
      <section class="starter">
        <div class="starter__head">
          <span class="starter__ord">${pattern.ord} · ${pattern.label}</span>
          <h2 class="starter__title">${s.name}</h2>
          ${s.description ? html`<p class="starter__desc">${s.description}</p>` : html``}
        </div>
        <div class="starter__body">
          <div class="starter__shape">
            ${miniDag(s.shape, { title: `${s.name}: ${describeDag(s.shape)}` })}
            <span class="starter__shape-text">${describeDag(s.shape)}</span>
          </div>
          ${pattern.teaches ? html`<p class="starter__teaches">${pattern.teaches}</p>` : html``}
          <dl class="starter__facts">
            <dt>Tools</dt>
            <dd>${s.tools.length > 0
              ? html`${s.tools.map((t) => html`<code>${t}</code> `) as unknown as SafeHtml[]}`
              : html`<span class="dim">none</span>`}</dd>
            <dt>Inputs</dt>
            <dd>${s.inputs.length > 0
              ? html`${s.inputs.map((n) => html`<code>${n}</code> `) as unknown as SafeHtml[]}`
              : html`<span class="dim">none</span>`}</dd>
            ${s.scheduled ? html`<dt>Runs</dt><dd>on a schedule</dd>` : html``}
          </dl>
          <div class="starter__actions">
            <a class="btn btn--primary btn--sm" href="/agents/${s.id}">Open and run →</a>
            <a class="starter__yaml" href="/agents/${s.id}?tab=yaml">Read the YAML</a>
          </div>
        </div>
      </section>
    `;
  });

  const empty = html`
    <div class="card">
      <p class="mt-0">
        The starter agents aren't installed yet. Run <code>sua examples install</code>,
        or browse everything under <a href="/agents?tab=examples">Agents → Examples</a>.
      </p>
    </div>
  `;

  const body = html`
    ${pageHeader({
      title: 'Quick start',
      cta: html`<a class="btn btn--ghost btn--sm" href="/help">Help &amp; docs</a>`,
    })}

    ${sectionTabs('start')}

    <div class="starters">
      ${/* pageHeader owns the page's only top-level heading, so this one is a
            level down. The old "START HERE" kicker is gone — it just repeated
            the tab label. */ html``}
      <h2 class="starters__title">Three agents, three patterns</h2>
      <p class="starters__lede">
        Each one is a handful of steps wired together, and every step is just
        an instruction plus a tool or two. Run one and watch the graph — nodes
        light up as they go, some run side by side, some get skipped. Then open
        the YAML and you'll see there was no magic in it.
      </p>

      ${args.starters.length > 0
        ? html`<div class="starters__grid">${cards as unknown as SafeHtml[]}</div>`
        : empty}

      <div class="starters__foot">
        <a class="btn btn--ghost btn--sm" href="/agents?tab=examples">
          Explore all ${args.exampleCount} examples →
        </a>
        <span class="starters__foot-note">
          Everything else is already installed — this page is just a shorter
          place to begin.
        </span>
      </div>
    </div>
  `;

  return render(layout({
    title: 'Start here',
    activeNav: 'agents',
    flash: args.flash ? { kind: 'ok', message: args.flash } : undefined,
  }, body));
}

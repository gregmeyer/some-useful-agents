import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

/**
 * Dashboard-native replacement for `sua tutorial`. Each step has an
 * inline action button that does the thing — no "open a terminal and
 * run X" handoffs. Step completion is derived from observable project
 * state (agents exist, runs exist, secrets declared, etc.) so a refresh
 * always reflects reality, not a cookie-remembered script.
 */

export interface TutorialState {
  /** Total agents the project has (v1 YAML + v2 DAG, deduped by id). */
  agentCount: number;
  /** Whether any agent has ever been run in this project. */
  hasAnyRun: boolean;
  /** Whether any run has a workflowId (i.e. it executed a multi-node DAG). */
  hasDagRun: boolean;
  /** Whether any agent uses at least one secret. */
  usesSecrets: boolean;
  /** Id of the friendliest starting agent (single-node v2 preferred). */
  firstAgentId?: string;
  /** Id of the most recent run, for the "inspect output" step. */
  latestRunId?: string;
  /** Whether the tutorial's scaffolded `hello` agent is already in the DB. */
  hasHelloAgent: boolean;
  /** Whether the tutorial's scaffolded `demo-digest` 2-node DAG is in the DB. */
  hasDemoDag: boolean;
  /** Whether the parameterised-greet example is in the DB. */
  hasParameterisedGreet: boolean;
  /** Whether the conditional-router example is in the DB. */
  hasConditionalRouter: boolean;
  /** Whether the research-digest example is in the DB. */
  hasResearchDigest: boolean;
  /** Optional flash message from a scaffold action (success or error). */
  flash?: string;
}

interface Step {
  n: number;
  title: string;
  done: boolean;
  summary: SafeHtml;
  action?: SafeHtml;
}

export function renderTutorial(state: TutorialState): string {
  const steps = buildSteps(state);
  const doneCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const allDone = doneCount === totalCount;

  const flashBlock = state.flash
    ? html`<div class="flash flash--info">${state.flash}</div>`
    : html``;

  const progress = html`
    <section class="card" style="margin-bottom: var(--space-6);">
      <p class="card__title">Progress</p>
      <p style="font-size: var(--font-size-md); margin: 0;">
        <strong>${String(doneCount)}</strong>
        <span class="dim"> of ${String(totalCount)} steps complete</span>
      </p>
      ${allDone
        ? html`<p class="dim" style="margin: var(--space-2) 0 0;">
            You've covered the basics. See <a href="/help">the full CLI reference</a> for what's next.
          </p>`
        : html`<p class="dim" style="margin: var(--space-2) 0 0;">
            Each step's status reflects your project's real state. Actions below run right here \u2014 no terminal required.
          </p>`}
    </section>
  `;

  const stepBlocks = steps.map(renderStep);

  const body = html`
    ${pageHeader({
      title: 'Dashboard tutorial',
      description: 'A guided first-run for the dashboard. Each step has an inline action.',
    })}
    ${flashBlock}
    ${progress}

    <ol style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3);">
      ${stepBlocks as unknown as SafeHtml[]}
    </ol>
  `;

  return render(layout({ title: 'Tutorial', activeNav: 'help' }, body));
}

function buildSteps(s: TutorialState): Step[] {
  return [
    step1HaveProject(s),
    step2RunAnAgent(s),
    step3InspectOutput(s),
    step4MultiNodeDag(s),
    step5ConfigurableInputs(s),
    step6FlowControl(s),
    step7WireUpSecret(s),
  ];
}

// ─── Step 1 ──────────────────────────────────────────────────────────
// "You have a project" — done when any agent is registered. Empty-state
// previews exactly what the scaffold-hello action will create, then the
// button does it; the redirect lands on /agents/hello so the user
// actually sees what they made instead of a flash on this same page.
function step1HaveProject(s: TutorialState): Step {
  const done = s.agentCount > 0;

  let summary: SafeHtml;
  if (done) {
    summary = html`<span class="dim">${String(s.agentCount)} agent${s.agentCount === 1 ? '' : 's'} registered. <a href="/agents">See them all \u2192</a></span>`;
  } else {
    summary = html`
      <div class="dim" style="margin-bottom: var(--space-3);">You have no agents yet. The button below will create a minimal one-node agent so you have something to run.</div>
      ${scaffoldPreview({
        kind: 'agent',
        id: 'hello',
        description: 'A minimal starter agent.',
        nodes: [{ id: 'greet', type: 'shell', body: "echo 'Hello from some-useful-agents!'" }],
      })}
    `;
  }

  let action: SafeHtml | undefined;
  if (done) {
    action = html`<a class="btn btn--sm" href="/agents">See agents \u2192</a>`;
  } else {
    action = html`
      <form method="POST" action="/help/tutorial/scaffold-hello" style="margin: 0; display: inline;">
        <button type="submit" class="btn btn--primary btn--sm">Create "hello" agent</button>
      </form>
    `;
  }

  return { n: 1, title: 'You have a project', done, summary, action };
}

// ─── Step 2 ──────────────────────────────────────────────────────────
// "Run your first agent" — done when any run exists. Action is a real
// Run-now form for the friendliest starting agent; no navigation needed.
function step2RunAnAgent(s: TutorialState): Step {
  const done = s.hasAnyRun;
  const summary = done
    ? html`<span class="dim">You've executed at least one run. Next: read its output.</span>`
    : s.firstAgentId
      ? html`<span class="dim">Click below to run <code>${s.firstAgentId}</code>. You'll land on the run detail page with stdout.</span>`
      : html`<span class="dim">Create an agent first (step 1).</span>`;

  let action: SafeHtml | undefined;
  if (done) {
    action = html`<a class="btn btn--sm" href="/runs">View runs \u2192</a>`;
  } else if (s.firstAgentId) {
    action = html`
      <form method="POST" action="/agents/${s.firstAgentId}/run" style="margin: 0; display: inline;">
        <input type="hidden" name="from" value="tutorial">
        <button type="submit" class="btn btn--primary btn--sm">Run ${s.firstAgentId} now</button>
      </form>
    `;
  }

  return { n: 2, title: 'Run your first agent', done, summary, action };
}

// ─── Step 3 ──────────────────────────────────────────────────────────
// "Inspect the output" — done when a run exists AND we have its id.
// Action deep-links to the latest run's detail page.
function step3InspectOutput(s: TutorialState): Step {
  const done = s.hasAnyRun && !!s.latestRunId;
  const summary = s.latestRunId
    ? html`<span class="dim">Open the latest run to see per-node stdout, status, duration, and any errors.</span>`
    : html`<span class="dim">Run an agent first (step 2).</span>`;

  const action = s.latestRunId
    ? html`<a class="btn btn--primary btn--sm" href="/runs/${s.latestRunId}">Open latest run \u2192</a>`
    : undefined;

  return { n: 3, title: 'Inspect the output', done, summary, action };
}

// ─── Step 4 ──────────────────────────────────────────────────────────
// "Multi-node DAG" — done when any run had workflowId. Action scaffolds
// a 2-node demo agent (fetch → summarize) the user can run immediately.
function step4MultiNodeDag(s: TutorialState): Step {
  const done = s.hasDagRun;

  let summary: SafeHtml;
  let action: SafeHtml | undefined;

  if (done) {
    summary = html`<span class="dim">You've executed a multi-node agent. The DAG viz on each run shows node-level status.</span>`;
    action = html`<a class="btn btn--sm" href="/agents">Browse DAG agents \u2192</a>`;
  } else if (s.hasDemoDag) {
    summary = html`<span class="dim">The <code>demo-digest</code> 2-node DAG is already scaffolded. <a href="/agents/demo-digest">View its DAG</a> or run it.</span>`;
    action = html`
      <form method="POST" action="/agents/demo-digest/run" style="margin: 0; display: inline;">
        <input type="hidden" name="from" value="tutorial">
        <button type="submit" class="btn btn--primary btn--sm">Run demo-digest</button>
      </form>
    `;
  } else {
    summary = html`
      <div class="dim" style="margin-bottom: var(--space-3);">Multi-node agents run nodes in topological order, passing each node's stdout to its downstream as an env var. Here's what you'll create:</div>
      ${scaffoldPreview({
        kind: 'agent',
        id: 'demo-digest',
        description: 'fetch \u2192 digest. The first node emits some text; the second counts its words.',
        nodes: [
          { id: 'fetch', type: 'shell', body: "echo 'item-1 item-2 item-3'" },
          { id: 'digest', type: 'shell', body: 'echo "Summary of:" && echo "$UPSTREAM_FETCH_RESULT" | wc -w', dependsOn: ['fetch'] },
        ],
      })}
    `;
    action = html`
      <form method="POST" action="/help/tutorial/scaffold-demo-dag" style="margin: 0; display: inline;">
        <button type="submit" class="btn btn--primary btn--sm">Scaffold demo DAG</button>
      </form>
    `;
  }

  return { n: 4, title: 'See a multi-node DAG in action', done, summary, action };
}

// ─── Step 5 ──────────────────────────────────────────────────────────
// "Make it configurable" — done when parameterised-greet exists.
function step5ConfigurableInputs(s: TutorialState): Step {
  const done = s.hasParameterisedGreet;

  let summary: SafeHtml;
  let action: SafeHtml | undefined;

  if (done) {
    summary = html`<span class="dim">The <code>parameterised-greet</code> agent is ready. Try running it with different inputs.</span>`;
    action = html`<a class="btn btn--sm" href="/agents/parameterised-greet">View agent \u2192</a>`;
  } else {
    summary = html`
      <div class="dim" style="margin-bottom: var(--space-3);">
        Agents can declare inputs with defaults. Users supply values at run time via <code>--input NAME=Greg</code>.
        This agent greets someone by name in a chosen style.
      </div>
    `;
    action = html`
      <form method="POST" action="/help/tutorial/scaffold-parameterised-greet" style="margin: 0; display: inline;">
        <button type="submit" class="btn btn--primary btn--sm">Create parameterised-greet</button>
      </form>
    `;
  }

  return { n: 5, title: 'Make it configurable (inputs)', done, summary, action };
}

// ─── Step 6 ──────────────────────────────────────────────────────────
// "Route with flow control" — done when conditional-router exists.
function step6FlowControl(s: TutorialState): Step {
  const done = s.hasConditionalRouter;

  let summary: SafeHtml;
  let action: SafeHtml | undefined;

  if (done) {
    summary = html`<span class="dim">The <code>conditional-router</code> agent is ready. Run it to see how data routes through different paths.</span>`;
    action = html`<a class="btn btn--sm" href="/agents/conditional-router">View agent \u2192</a>`;
  } else {
    summary = html`
      <div class="dim" style="margin-bottom: var(--space-3);">
        Flow control nodes let agents make decisions. A <code>conditional</code> node evaluates a predicate;
        downstream nodes use <code>onlyIf</code> to run only when the condition matches. A <code>branch</code>
        node merges the results.
      </div>
    `;
    action = html`
      <form method="POST" action="/help/tutorial/scaffold-conditional-router" style="margin: 0; display: inline;">
        <button type="submit" class="btn btn--primary btn--sm">Create conditional-router</button>
      </form>
    `;
  }

  return { n: 6, title: 'Route with flow control', done, summary, action };
}

// ─── Step 7 ──────────────────────────────────────────────────────────
// "Wire up a secret" — done when any agent declares a secret.
function step7WireUpSecret(s: TutorialState): Step {
  const done = s.usesSecrets;
  const summary = done
    ? html`<span class="dim">At least one agent declares a secret. Verify it's set on the Settings page.</span>`
    : html`
        <span class="dim">
          Declare <code>secrets: [SLACK_WEBHOOK]</code> on a node, then store the value with
          <code>sua secrets set SLACK_WEBHOOK</code>. Dashboard CRUD for secrets lands in the next v0.15 PR.
        </span>
      `;

  const action = html`<a class="btn btn--sm" href="/settings/secrets">Open Settings \u2192 Secrets</a>`;

  return { n: 5, title: 'Wire up a secret', done, summary, action };
}

// ─── Preview helper ──────────────────────────────────────────────────

interface ScaffoldNode {
  id: string;
  type: 'shell' | 'claude-code';
  body: string;
  dependsOn?: string[];
}
interface ScaffoldPreviewArgs {
  kind: 'agent';
  id: string;
  description: string;
  nodes: ScaffoldNode[];
}

/**
 * Compact, inline preview of what a scaffold action will create. Sets
 * expectations BEFORE the user clicks the button — so they're not just
 * trusting an opaque "Create X" button to do something sensible.
 */
function scaffoldPreview(p: ScaffoldPreviewArgs): SafeHtml {
  const nodeRows = p.nodes.map((n) => {
    const depsLabel = n.dependsOn?.length
      ? html` <span class="dim" style="font-size: var(--font-size-xs);">\u2190 depends on: ${n.dependsOn.join(', ')}</span>`
      : html``;
    return html`
      <li style="margin-bottom: var(--space-2);">
        <div>
          <code>${n.id}</code>
          <span class="badge badge--${n.type === 'shell' ? 'ok' : 'info'}" style="margin-left: var(--space-1);">${n.type}</span>
          ${depsLabel}
        </div>
        <pre style="margin: var(--space-1) 0 0; padding: var(--space-2) var(--space-3); font-size: var(--font-size-xs); background: var(--color-surface-raised); border-radius: var(--radius-sm); overflow-x: auto;">${n.body}</pre>
      </li>
    `;
  });

  return html`
    <div class="card card--muted" style="margin-top: var(--space-2);">
      <div style="display: flex; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-2);">
        <span class="card__title" style="margin: 0;">Will create</span>
        <code style="font-size: var(--font-size-sm);">${p.id}</code>
        <span class="dim" style="font-size: var(--font-size-xs);">\u2014 ${p.description}</span>
      </div>
      <ol style="margin: 0; padding-left: var(--space-6);">
        ${nodeRows as unknown as SafeHtml[]}
      </ol>
    </div>
  `;
}

// ─── Renderer ────────────────────────────────────────────────────────

function renderStep(s: Step): SafeHtml {
  const statusBadge = s.done
    ? html`<span class="badge badge--ok">done</span>`
    : html`<span class="badge badge--muted">to do</span>`;

  return html`
    <li class="card" style="padding: var(--space-4) var(--space-6);">
      <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2); flex-wrap: wrap;">
        <span class="mono dim" style="font-size: var(--font-size-xs);">Step ${String(s.n)}</span>
        <strong style="font-size: var(--font-size-md);">${s.title}</strong>
        ${statusBadge}
        ${s.action ? html`<span style="margin-left: auto;">${s.action}</span>` : html``}
      </div>
      <div style="color: var(--color-text);">${s.summary}</div>
    </li>
  `;
}

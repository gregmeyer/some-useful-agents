import type { Agent } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export const DEFAULT_PROMPT = `You are an expert agent architect reviewing a sua DAG agent.

Analyze the FULL agent holistically — cross-node data flow, dependency
ordering, input/variable usage, prompt quality, error handling, and
whether the design achieves its purpose efficiently.

Look for:
- Missing variables or inputs that would improve configurability
- Hardcoded values that should be agent inputs or global variables
- Missing error handling, timeouts, or retry logic
- Opportunities to split or merge nodes for clarity
- Unused or redundant dependencies between nodes
- Prompt improvements for claude-code nodes

Classify your assessment as exactly one of:
- NO_IMPROVEMENTS: The agent is well-designed, no changes needed.
- SUGGESTIONS: Specific improvements that would make the agent better.
- REWRITE: The fundamental approach or logic should be rethought.

Respond in EXACTLY this format (keep the XML tags):
<classification>NO_IMPROVEMENTS | SUGGESTIONS | REWRITE</classification>
<summary>One sentence summarizing your assessment</summary>
<details>
Your detailed analysis. Be specific: name nodes, variables, prompts.
For multi-node agents, analyze how data flows between nodes.
</details>
<yaml>
If SUGGESTIONS or REWRITE, provide the complete improved YAML.
Must be valid, keep the same agent id. If NO_IMPROVEMENTS, leave empty.
</yaml>`;

// ── Types ──────────────────────────────────────────────────────────────

type Classification = 'NO_IMPROVEMENTS' | 'SUGGESTIONS' | 'REWRITE';

interface SuggestionJob {
  agentId: string;
  status: 'pending' | 'done' | 'error';
  classification?: Classification;
  summary?: string;
  details?: string;
  suggestedYaml?: string;
  rawOutput?: string;
  error?: string;
}

// ── Form page ──────────────────────────────────────────────────────────

export function renderSuggestForm(args: {
  agent: Agent;
  defaultPrompt: string;
  currentYaml: string;
  llmAvailable: boolean;
  error?: string;
}): string {
  const { agent, defaultPrompt, currentYaml, llmAvailable, error } = args;

  const errorBlock = error
    ? html`<div class="flash flash--error">${error}</div>`
    : html``;

  const llmWarning = !llmAvailable
    ? html`<div class="flash flash--error" style="margin-bottom: var(--space-4);">Claude CLI is not installed. Install it to use AI suggestions.</div>`
    : html``;

  const body = html`
    ${pageHeader({
      title: `Suggest improvements`,
      back: { href: `/agents/${agent.id}`, label: `Back to ${agent.id}` },
      description: `AI-powered analysis of ${agent.id} (v${String(agent.version)}, ${String(agent.nodes.length)} nodes). Edit the prompt below to focus the analysis.`,
    })}

    ${errorBlock}
    ${llmWarning}

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); align-items: start;">
      <form method="POST" action="/agents/${agent.id}/suggest" class="card">
        <p class="card__title">Analysis prompt</p>
        <p class="dim" style="font-size: var(--font-size-xs); margin-bottom: var(--space-2);">
          Edit to focus the analysis, e.g. "what variables am I missing to count loop iterations?"
        </p>
        <textarea name="prompt" rows="18" required
          style="width: 100%; padding: var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); resize: vertical; line-height: 1.5;"
        >${defaultPrompt}</textarea>
        <div style="margin-top: var(--space-3); display: flex; gap: var(--space-2); justify-content: flex-end;">
          <a class="btn btn--ghost" href="/agents/${agent.id}">Cancel</a>
          <button type="submit" class="btn btn--primary" ${llmAvailable ? '' : 'disabled'}>Analyze with Claude</button>
        </div>
      </form>

      <div class="card" style="max-height: 520px; overflow-y: auto;">
        <p class="card__title">Current YAML</p>
        <pre style="font-size: var(--font-size-xs); margin: 0; white-space: pre-wrap; word-break: break-all;">${currentYaml}</pre>
      </div>
    </div>
  `;

  return render(layout({ title: `Suggest \u2014 ${agent.id}`, activeNav: 'agents' }, body));
}

// ── Polling page ───────────────────────────────────────────────────────

export function renderSuggestPolling(args: {
  agent: Agent;
  jobId: string;
}): string {
  const { agent, jobId } = args;

  const body = html`
    ${pageHeader({
      title: `Analyzing ${agent.id}`,
      back: { href: `/agents/${agent.id}`, label: `Back to ${agent.id}` },
    })}

    <div data-suggest-container data-suggest-in-progress="${jobId}" data-suggest-agent="${agent.id}">
      <div class="card" style="text-align: center; padding: var(--space-8);">
        <div style="font-size: var(--font-size-lg); margin-bottom: var(--space-3);">Analyzing agent...</div>
        <p class="dim">Claude is reviewing ${String(agent.nodes.length)} node${agent.nodes.length === 1 ? '' : 's'}. This usually takes 10\u201330 seconds.</p>
        <div class="spinner" style="margin: var(--space-4) auto;"></div>
      </div>
    </div>
  `;

  return render(layout({ title: `Analyzing \u2014 ${agent.id}`, activeNav: 'agents' }, body));
}

// ── Polling fragment ───────────────────────────────────────────────────

export function renderSuggestFragment(args: {
  agent: Agent;
  job: SuggestionJob;
  jobId: string;
  currentYaml: string;
}): string {
  const { agent, job, jobId, currentYaml } = args;

  if (job.status === 'pending') {
    return render(html`
      <div data-suggest-container data-suggest-in-progress="${jobId}" data-suggest-agent="${agent.id}">
        <div class="card" style="text-align: center; padding: var(--space-8);">
          <div style="font-size: var(--font-size-lg); margin-bottom: var(--space-3);">Analyzing agent...</div>
          <p class="dim">Claude is reviewing ${String(agent.nodes.length)} node${agent.nodes.length === 1 ? '' : 's'}. This usually takes 10\u201330 seconds.</p>
          <div class="spinner" style="margin: var(--space-4) auto;"></div>
        </div>
      </div>
    `);
  }

  // Done or error — render the result inline so the poller can swap it in.
  return render(html`
    <div data-suggest-container>
      ${renderResultContent(agent, job, currentYaml, jobId)}
    </div>
  `);
}

// ── Results page ───────────────────────────────────────────────────────

export function renderSuggestResult(args: {
  agent: Agent;
  job: SuggestionJob;
  currentYaml: string;
  error?: string;
}): string {
  const { agent, job, currentYaml, error } = args;

  const errorBlock = error
    ? html`<div class="flash flash--error" style="margin-bottom: var(--space-4);">${error}</div>`
    : html``;

  const body = html`
    ${pageHeader({
      title: `Suggestions for ${agent.id}`,
      back: { href: `/agents/${agent.id}`, label: `Back to ${agent.id}` },
    })}
    ${errorBlock}
    <div data-suggest-container>
      ${renderResultContent(agent, job, currentYaml)}
    </div>
  `;

  return render(layout({ title: `Suggestions \u2014 ${agent.id}`, activeNav: 'agents' }, body));
}

// ── Shared result content ──────────────────────────────────────────────

function classificationBadge(c: Classification | undefined): SafeHtml {
  switch (c) {
    case 'NO_IMPROVEMENTS':
      return html`<span class="badge badge--ok">No improvements needed</span>`;
    case 'REWRITE':
      return html`<span class="badge badge--err">Recommend rewrite</span>`;
    case 'SUGGESTIONS':
    default:
      return html`<span class="badge badge--warn">Suggested improvements</span>`;
  }
}

function renderResultContent(agent: Agent, job: SuggestionJob, currentYaml: string, jobId?: string): SafeHtml {
  if (job.status === 'error') {
    return html`
      <div class="card">
        <div class="flash flash--error">${job.error ?? 'Unknown error'}</div>
        <div style="margin-top: var(--space-3); display: flex; gap: var(--space-2);">
          <a class="btn btn--primary btn--sm" href="/agents/${agent.id}/suggest">Try again</a>
          <a class="btn btn--ghost btn--sm" href="/agents/${agent.id}">Dismiss</a>
        </div>
      </div>
    `;
  }

  const hasSuggestedYaml = !!job.suggestedYaml && job.classification !== 'NO_IMPROVEMENTS';

  const diffSection = hasSuggestedYaml ? html`
    <div class="card" style="margin-top: var(--space-4);">
      <p class="card__title">YAML diff</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-top: var(--space-2);">
        <div>
          <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-1);">Current</p>
          <pre style="font-size: var(--font-size-xs); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;">${currentYaml}</pre>
        </div>
        <div>
          <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-1);">Suggested</p>
          <pre style="font-size: var(--font-size-xs); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;">${job.suggestedYaml!}</pre>
        </div>
      </div>
    </div>
  ` : html``;

  const applySection = hasSuggestedYaml ? html`
    <div style="margin-top: var(--space-4); display: flex; gap: var(--space-2); flex-wrap: wrap;">
      <form method="POST" action="/agents/${agent.id}/suggest/apply" style="margin: 0;">
        <input type="hidden" name="suggestedYaml" value="${job.suggestedYaml!}">
        ${jobId ? html`<input type="hidden" name="jobId" value="${jobId}">` : html``}
        <button type="submit" class="btn btn--primary">Apply suggestions</button>
      </form>
      <form method="POST" action="/agents/${agent.id}/yaml" style="margin: 0;">
        <input type="hidden" name="prefillYaml" value="${job.suggestedYaml!}">
        <button type="submit" class="btn btn--sm">Edit suggested YAML first</button>
      </form>
      <a class="btn btn--ghost" href="/agents/${agent.id}">Dismiss</a>
    </div>
  ` : html`
    <div style="margin-top: var(--space-4);">
      <a class="btn btn--ghost" href="/agents/${agent.id}">Back to agent</a>
    </div>
  `;

  return html`
    <div class="card">
      <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3);">
        ${classificationBadge(job.classification)}
        <span style="font-size: var(--font-size-sm); font-weight: var(--weight-medium);">${job.summary ?? ''}</span>
      </div>
      <div style="font-size: var(--font-size-sm); line-height: 1.6;">
        <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${job.details ?? ''}</pre>
      </div>
    </div>
    ${diffSection}
    ${applySection}
  `;
}

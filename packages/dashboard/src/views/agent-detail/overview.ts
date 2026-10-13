import { html, type SafeHtml } from '../html.js';
import { formatDuration, formatAge, cronToHuman } from '../components.js';
import { renderDagView, renderDagFallback } from '../dag-view.js';
import { runWidget } from '../run-detail.js';
import { renderRunInputsForm } from '../agent-detail-helpers.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';
import type { AgentEdge } from '../../lib/agent-graph.js';
import { formatUsd, type Memory } from '@some-useful-agents/core';

export async function renderAgentOverview(args: AgentDetailArgs): Promise<string> {
  const { agent, recentRuns, widgetControls, behaviorStatus } = args;
  const latestCompletedRun = recentRuns.find((r) => r.status === 'completed');
  const latestRun = recentRuns[0];
  const latestRunInputsJson = (latestRun as { inputsJson?: string } | undefined)?.inputsJson;
  const hasCommunityShellNode = agent.source === 'community' && agent.nodes.some((n) => n.type === 'shell');
  const previousInputs = (() => {
    if (!latestRunInputsJson) return undefined;
    try {
      return JSON.parse(latestRunInputsJson) as Record<string, string>;
    } catch {
      return undefined;
    }
  })();

  // Quick stats row. Tools-used comes from `agent.capabilities` — the
  // canonical static analysis (parse-time, includes explicit `tool:`,
  // type-based desugaring, AND `allowedTools`). Falls back to a node-level
  // walk only if capabilities wasn't computed (e.g., older row not yet
  // re-read). claude-code-native tools (Bash, Edit, etc.) link to /tools
  // and will 404 there; skipping the link keeps users out of dead ends.
  const toolsUsed = agent.capabilities?.tools_used && agent.capabilities.tools_used.length > 0
    ? agent.capabilities.tools_used
    : (() => {
        const ids = new Set<string>();
        for (const n of agent.nodes) {
          if (n.tool) ids.add(n.tool);
          else if (n.type === 'shell') ids.add('shell-exec');
          else if (n.type === 'llm-prompt' || n.type === 'claude-code') ids.add('claude-code');
          for (const t of n.tools ?? []) ids.add(t);
        }
        return [...ids].sort();
      })();
  // Linkable tool ids match sua's kebab-lowercase convention (built-ins,
  // user tools, MCP-imported tools all use it). Claude-code-native tools
  // like `Bash` / `Edit` / `NotebookEdit` ship in capitalised form and
  // have no `/tools` entry — render those as plain badges.
  const isLinkable = (id: string) => /^[a-z][a-z0-9_-]*$/.test(id);
  const toolBadges = toolsUsed.map((id) => isLinkable(id)
    ? html`<a href="/tools/${id}" class="badge badge--muted" style="text-decoration: none;">${id}</a>`
    : html`<span class="badge badge--muted" title="Built into the LLM runtime; no /tools entry.">${id}</span>`);

  /**
   * "What you can ask" — the routing metadata, finally rendered.
   *
   * `sampleQuestions` / `entryConditions` / `nonEntryConditions` have been in
   * the schema and read by every router for a while, but appeared in ZERO
   * views, so the one audience who most needs them (someone deciding whether
   * this is the right agent) could never see them. The questions are chips
   * that fill the ask band; the conditions are plain prose, since they
   * describe situations rather than things you'd type.
   */
  const sampleQuestions = (agent.sampleQuestions ?? []).filter((q) => q.trim().length > 0);
  const useWhen = (agent.entryConditions ?? []).filter((c) => c.trim().length > 0);
  const notFor = (agent.nonEntryConditions ?? []).filter((c) => c.trim().length > 0);
  const hasRouting = sampleQuestions.length > 0 || useWhen.length > 0 || notFor.length > 0;

  const routingSection = !hasRouting ? html`` : html`
    <section class="ask-panel">
      ${sampleQuestions.length > 0 ? html`
        <h2 class="ask-panel__title">What you can ask</h2>
        <p class="dim ask-panel__hint">Click one to drop it into the <span class="mono">sua &rsaquo;</span> bar. Nothing is sent until you hit Send.</p>
        <div class="ask-panel__chips">
          ${sampleQuestions.map((q) => html`
            <button type="button" class="ask-chip" data-ask="${q}">${q}</button>
          `) as unknown as SafeHtml[]}
        </div>
      ` : html``}
      ${useWhen.length > 0 || notFor.length > 0 ? html`
        <div class="ask-panel__conditions">
          ${useWhen.length > 0 ? html`
            <div>
              <h3 class="ask-panel__subtitle">Use when</h3>
              <ul class="ask-panel__list">
                ${useWhen.map((c) => html`<li>${c}</li>`) as unknown as SafeHtml[]}
              </ul>
            </div>
          ` : html``}
          ${notFor.length > 0 ? html`
            <div>
              <h3 class="ask-panel__subtitle ask-panel__subtitle--muted">Not for</h3>
              <ul class="ask-panel__list ask-panel__list--muted">
                ${notFor.map((c) => html`<li>${c}</li>`) as unknown as SafeHtml[]}
              </ul>
            </div>
          ` : html``}
        </div>
      ` : html``}
    </section>
  `;

  const declared = agent.behaviors ?? [];
  const heldTo = declared.length === 0 ? html`` : html`
    <dt>Held to</dt>
    <dd>
      ${declared.map((name) => {
        const status = behaviorStatus?.find((b) => b.name === name);
        const broken = status ? !status.usable : false;
        return html`<span style="display: inline-block; margin-right: var(--space-2);">
          <a href="/behaviors/${encodeURIComponent(name)}" class="mono">${name}</a>${broken
            ? html` <span class="badge badge--err" title="${status?.reason ?? ''}">unusable</span>`
            : html``}
        </span>`;
      }) as unknown as SafeHtml[]}
      ${behaviorStatus?.some((b) => !b.usable)
        ? html`<div class="dim" style="font-size: var(--font-size-xs); margin-top: var(--space-1);">
            This agent will fail to run until every declared behavior resolves in this project.
          </div>`
        : html``}
    </dd>
  `;

  const last = args.latestResult;
  const newest = recentRuns[0];
  const running = recentRuns.find((r) => r.status === 'running' || r.status === 'pending');
  const newestFailed = newest && newest.status === 'failed' && (!last || newest.startedAt > last.run.startedAt) ? newest : undefined;
  const hasInputs = Object.keys(agent.inputs ?? {}).length > 0;
  const canRunInline = hasInputs && agent.status !== 'archived' && !hasCommunityShellNode;

  const latestResult = html`
    <section class="agent-result" aria-labelledby="agent-result-title">
      <div class="agent-result__head">
        <h2 class="section-label" id="agent-result-title">Latest result</h2>
        ${last ? html`<span class="dim agent-result__meta">${formatAge(last.run.completedAt ?? last.run.startedAt)} · ${formatDuration(last.run.startedAt, last.run.completedAt)} · <a href="/runs/${last.run.id}">open the run →</a></span>` : html``}
      </div>
      ${running ? html`<p class="agent-result__note"><span class="agent-result__dot" aria-hidden="true"></span>Running now, started ${formatAge(running.startedAt)}. <a href="/runs/${running.id}">Watch it →</a></p>` : html``}
      ${newestFailed && !running ? html`<p class="agent-result__note agent-result__note--err">The newest run failed ${formatAge(newestFailed.startedAt)}${newestFailed.error ? html`: <span class="agent-result__err">${firstLine(newestFailed.error)}</span>` : html``}. <a href="/runs/${newestFailed.id}">Open it →</a>${last ? html` Below is the last one that finished.` : html``}</p>` : html``}
      <div class="agent-result__body">
        ${last
          ? runWidget(agent, last.run, last.nodeExecutions, widgetControls, last.history, `latest-${agent.id}`)
          : html`<p class="dim agent-result__empty">No result yet. ${agent.status === 'archived' ? 'Restore it to run it.' : 'Run it to see what it makes.'}</p>`}
      </div>
      ${canRunInline ? html`<details class="agent-result__inputs"${last ? html`` : html` open`}>
        <summary>Run with ${last ? 'different' : 'these'} inputs</summary>
        ${renderRunInputsForm(agent, args.from, previousInputs, { inline: true })}
      </details>` : html``}
    </section>
  `;

  // The last runs, oldest to newest, as dots; how many finished.
  const strip = recentRuns.slice(0, 12).reverse();
  const finished = strip.filter((r) => r.status === 'completed').length;
  const ended = strip.filter((r) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled').length;
  const looks = agent.view ? ('from' in agent.view ? 'A view its step writes' : 'Its view') : agent.outputWidget ? 'Its output widget' : 'Plain text';

  const glance = html`
    <aside class="agent-glance" aria-label="At a glance">
      <h2 class="section-label">At a glance</h2>
      <div class="agent-glance__runs">
        ${strip.length === 0 ? html`<span class="dim">No runs yet.</span>` : html`
          <span class="agent-glance__dots">${strip.map((r) => html`<a href="/runs/${r.id}" class="run-dot run-dot--${r.status}" title="${r.status}, ${formatAge(r.startedAt)}" aria-label="Run ${r.id.slice(0, 8)}: ${r.status}, ${formatAge(r.startedAt)}"></a>`) as unknown as SafeHtml[]}</span>
          <span class="dim">${ended > 0 ? `${String(finished)} of ${String(ended)} finished` : `${String(strip.length)} running`}</span>
          <a href="/agents/${agent.id}/runs" class="agent-glance__all">All runs →</a>`}
      </div>
      <dl class="kv agent-glance__facts">
        <dt>Version</dt><dd class="mono">v${String(agent.version)} <a href="/agents/${agent.id}/versions" class="dim text-xs">history</a></dd>
        <dt>Model</dt><dd class="mono">${agent.provider ?? 'claude'} · ${agent.model ?? 'default'}</dd>
        <dt>Runs</dt><dd>${agent.schedule ? html`<span title="${agent.schedule}">${cronToHuman(agent.schedule)}</span>` : html`Only when asked`}</dd>
        <dt>Looks</dt><dd>${looks} <a href="/agents/${agent.id}/view" class="dim text-xs">edit</a></dd>
        ${agent.mcp ? html`<dt>AI apps</dt><dd>Can call it (MCP)</dd>` : html``}
        ${args.spend7d ? html`<dt>Spend, 7 days</dt><dd><span class="mono" title="USD at list price, incl. agents it called">${formatUsd(args.spend7d.costUsd, args.spend7d.costComplete)}</span> <span class="dim">over ${String(args.spend7d.runs)} run${args.spend7d.runs === 1 ? '' : 's'}</span></dd>` : html``}
        ${spendLimitsRow(args.spendLimits)}
        ${heldTo}
      </dl>
      ${toolBadges.length > 0 ? html`<div class="agent-glance__tools">${toolBadges as unknown as SafeHtml[]}</div>` : html``}
      ${connectionsList(agent.id, args.invokes ?? [], args.invokedBy ?? [], args.feedsNotebooks ?? [], args.connectedAgents ?? {})}
    </aside>
  `;

  const content = html`
    <div class="agent-overview">
      ${latestResult}
      ${glance}
    </div>

    ${goalCard(agent)}
    ${agent.nodes.length === 1 && agent.nodes[0].type === 'goal' ? html`` : html`
      <section class="agent-how" aria-labelledby="agent-how-title">
        <div class="agent-how__head">
          <h2 class="section-label" id="agent-how-title">How it works</h2>
          <a href="/agents/${agent.id}/nodes" class="dim text-xs">Edit in Nodes →</a>
        </div>
        <p class="agent-how__chain">${agent.nodes.map((n, i) => html`${i > 0 ? html`<span class="dim" aria-hidden="true"> → </span>` : html``}<a href="/agents/${agent.id}/nodes/${encodeURIComponent(n.id)}/edit" class="mono" title="${n.type}">${n.id}</a>`) as unknown as SafeHtml[]}
          <span class="dim text-xs"> · ${String(agent.nodes.length)} step${agent.nodes.length === 1 ? '' : 's'}</span></p>
        <details class="agent-how__diagram">
          <summary class="dim">Show the diagram</summary>
          ${renderDagFallback(agent)}
          ${renderDagView({
            agent,
            editBase: `/agents/${agent.id}/nodes`,
            editable: true,
            replay: latestCompletedRun
              ? { priorRunId: latestCompletedRun.id, requiresCommunityConfirm: hasCommunityShellNode }
              : undefined,
          })}
        </details>
      </section>`}

    ${memorySection(agent.id, args.memories)}

    ${hasRouting ? html`<details class="agent-when">
      <summary><span class="section-label">When to use it</span>${sampleQuestions.length > 0 ? html` <span class="dim text-xs">${String(sampleQuestions.length)} thing${sampleQuestions.length === 1 ? '' : 's'} you can ask</span>` : html``}</summary>
      ${routingSection}
    </details>` : html``}

    <!-- Danger zone — hard delete. Hidden behind a disclosure so it
         can't be hit by an idle scroll-and-click. The form's input
         pattern requires the operator to type the agent id verbatim
         before the browser will submit. -->
    <section style="margin-top: var(--space-6); border-top: 1px solid var(--color-border); padding-top: var(--space-4);">
      <details>
        <summary style="cursor: pointer; color: var(--color-err); font-weight: var(--weight-bold);">Danger zone</summary>
        <div class="card" style="padding: var(--space-4); margin-top: var(--space-3); border-color: var(--color-err);">
          <p style="margin-top: 0;">
            <strong>Delete this agent.</strong>
            All ${String(agent.nodes.length)}-node ${agent.source === 'community' ? 'community ' : ''}DAG and every prior version are removed.
            <span class="dim">Run history is kept (orphaned — runs reference the agent by id, no FK).</span>
          </p>
          <form method="POST" action="/agents/${agent.id}/delete" style="display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap;">
            <label style="font-size: var(--font-size-xs);">
              Type <code>${agent.id}</code> to confirm:
              <input type="text" name="confirm" required
                pattern="^${agent.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$"
                placeholder="${agent.id}"
                style="margin-left: var(--space-2); font-family: var(--font-mono);" />
            </label>
            <button type="submit" class="btn btn--sm" style="color: var(--color-err); border-color: var(--color-err);">
              Delete forever
            </button>
          </form>
        </div>
      </details>
    </section>
  `;

  return agentPageShell({ ...args, activeTab: 'overview' }, content);
}

/**
 * What the agent remembers between runs (agents with `memory:` on).
 *
 * Pinned notes are given to every run; the rest are recalled when they match
 * the run's inputs. Forgetting is immediate and can't be undone.
 */
function memorySection(agentId: string, memories: Memory[] | undefined): SafeHtml {
  if (memories === undefined) return html``;
  const base = `/agents/${encodeURIComponent(agentId)}/memory`;
  const rows = memories.map((m) => html`
    <li class="memory-item" style="display: flex; gap: var(--space-3); align-items: baseline; padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border);">
      <span class="mono dim" style="font-size: var(--font-size-xs); flex: none;">${m.id}</span>
      <span style="flex: 1; min-width: 0; overflow-wrap: anywhere;">
        ${m.pinned ? html`<span class="badge" style="margin-right: var(--space-1);">pinned</span>` : html``}${m.text}
        ${m.tags.length ? html`<span class="dim" style="font-size: var(--font-size-xs);"> · ${m.tags.join(', ')}</span>` : html``}
        <span class="dim" style="font-size: var(--font-size-xs); display: block;">${formatAge(m.updatedAt)}${m.sourceRunId ? html` · <a href="/runs/${m.sourceRunId}">from run ${m.sourceRunId.slice(0, 8)}</a>` : html``}</span>
      </span>
      <form method="POST" action="${base}/${encodeURIComponent(m.id)}/pin" style="flex: none;">
        <input type="hidden" name="pinned" value="${m.pinned ? 'false' : 'true'}" />
        <button type="submit" class="btn btn--sm btn--ghost">${m.pinned ? 'Unpin' : 'Pin'}</button>
      </form>
      <form method="POST" action="${base}/${encodeURIComponent(m.id)}/forget" style="flex: none;">
        <button type="submit" class="btn btn--sm btn--ghost" style="color: var(--color-err);">Forget</button>
      </form>
    </li>`);
  return html`
    <section>
      <h2>Memory</h2>
      <p class="dim" style="font-size: var(--font-size-xs); margin-top: 0;">
        Notes this agent saved for itself. Pinned notes are given to every run; the rest are given when they match the run's inputs. Forget removes a note for good.
      </p>
      ${memories.length === 0
        ? html`<p class="dim">Nothing remembered yet. The agent saves notes as it runs.</p>`
        : html`<ul style="list-style: none; padding: 0; margin: 0;">${rows as unknown as SafeHtml[]}</ul>`}
    </section>
  `;
}

/**
 * This agent's place in the call graph, in the side column: who calls it,
 * what it calls, and the notebooks it fills. Nothing when it has none.
 * (`id="agent-connections"` keeps old "how ↓" links working.)
 */
function connectionsList(id: string, invokes: AgentEdge[], invokedBy: AgentEdge[], notebooks: ReadonlyArray<{ id: string; title: string; status: string }>, info: ConnectedAgents): SafeHtml {
  if (invokes.length === 0 && invokedBy.length === 0 && notebooks.length === 0) return html``;
  const callers = [...new Map(invokedBy.map((e) => [e.from, e])).values()];
  const callees = [...new Map(invokes.map((e) => [e.dynamic ? `~${e.to}` : e.to, e])).values()];
  const via = (e: AgentEdge) => html`<span class="dim text-xs"> via <code>${e.nodeId}</code>${e.via === 'loop' ? ', once per item' : e.via === 'tool' ? ', as a tool when the model decides to' : ''}</span>`;
  const callee = (e: AgentEdge): SafeHtml => e.dynamic
    ? html`<span class="dim">an agent chosen at run time</span>`
    : !e.resolved ? html`<code>${e.to}</code> <span class="badge badge--err">missing</span>`
    : html`<a href="/agents/${e.to}" class="mono" title="${shortAbout(info[e.to]?.description)}">${e.to}</a>${agentTags(info[e.to])}`;
  return html`
    <div class="agent-glance__links" id="agent-connections">
      ${callers.length > 0 ? html`<p class="agent-glance__label">Called by</p>
        <ul>${callers.map((e) => html`<li><a href="/agents/${e.from}" class="mono" title="${shortAbout(info[e.from]?.description)}">${e.from}</a>${agentTags(info[e.from])}${via(e)}</li>`) as unknown as SafeHtml[]}</ul>
        <p class="dim text-xs agent-glance__note">A change to ${id} changes what ${callers.length === 1 ? 'it gets' : 'they get'}.</p>` : html``}
      ${callees.length > 0 ? html`<p class="agent-glance__label">Calls</p>
        <ul>${callees.map((e) => html`<li>${callee(e)}${via(e)}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
      ${notebooks.length > 0 ? html`<p class="agent-glance__label">Fills notebooks</p>
        <ul>${notebooks.map((n) => html`<li><a href="/notebooks/${encodeURIComponent(n.id)}">${n.title}</a>${n.status !== 'active' ? html` <span class="dim text-xs">${n.status}</span>` : html``} <a class="dim text-xs" href="/notebooks/${encodeURIComponent(n.id)}/workflow">how it was made →</a></li>`) as unknown as SafeHtml[]}</ul>` : html``}
    </div>
  `;
}

/** The first line of an error, cut to fit one line. */
function firstLine(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

type ConnectedAgents = Record<string, { status: string; description?: string }>;

/** "draft" / "paused" (it won't run on its own like that) and "helper", after an agent's id. */
function agentTags(a: { status: string; description?: string } | undefined): SafeHtml {
  if (!a) return html``;
  const helper = /^Helper for /i.test(a.description ?? '');
  return html`${a.status !== 'active' ? html` <span class="badge ${a.status === 'archived' ? 'badge--err' : 'badge--muted'}">${a.status}</span>` : html``}${helper ? html` <span class="badge badge--info">helper</span>` : html``}`;
}

/** An agent's description cut to its first sentence (and ~110 characters), minus a "Helper for X:" prefix. */
export function shortAbout(description: string | undefined): string {
  const d = (description ?? '').replace(/^Helper for [^:]+:\s*/i, '').trim();
  const m = d.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? d;
  const first = m.charAt(0).toUpperCase() + m.slice(1);
  return first.length > 110 ? `${first.slice(0, 107).trimEnd()}…` : first;
}

/** "Limits: $2.00 a day ($0.40 spent today) · $0.50 a run", with where they come from. */
function spendLimitsRow(s: AgentDetailArgs['spendLimits']): SafeHtml {
  if (!s) return html``;
  const { limits, spentToday, unenforceable } = s;
  const from = (src: 'agent' | 'default' | undefined) => src === 'default'
    ? html` <a href="/settings/usage#limits" class="dim" style="font-size: var(--font-size-xs);">default</a>`
    : html``;
  const parts: SafeHtml[] = [];
  if (limits.perDayUsd !== undefined) {
    const reached = spentToday >= limits.perDayUsd;
    parts.push(html`<span class="mono">${formatUsd(limits.perDayUsd)}</span> a day${from(limits.source.perDayUsd)}
      <span class="${reached ? '' : 'dim'}" style="${reached ? 'color: var(--color-err);' : ''}">(${formatUsd(spentToday)} spent today${reached ? ' — new runs are refused until midnight' : ''})</span>`);
  }
  if (limits.perRunUsd !== undefined) {
    parts.push(html`<span class="mono">${formatUsd(limits.perRunUsd)}</span> a run${from(limits.source.perRunUsd)}`);
  }
  return html`<dt>Spend limits</dt><dd>
    ${parts.map((p, i) => html`${i > 0 ? html` · ` : html``}${p}`) as unknown as SafeHtml[]}
    ${unenforceable.length > 0
      ? html`<br><span style="color: var(--color-warn); font-size: var(--font-size-xs);">${unenforceable.join(', ')} ${unenforceable.length === 1 ? 'has' : 'have'} no price, so runs on ${unenforceable.length === 1 ? 'it don\'t' : 'them don\'t'} count. <a href="/settings/llm#pricing">Set a price</a>.</span>`
      : html``}
  </dd>`;
}

/**
 * An agent that is one goal node: lead with what it works toward, the tools
 * it may use, and its budget (a one-node diagram says nothing). Edit opens
 * the goal form.
 */
function goalCard(agent: AgentDetailArgs['agent']): SafeHtml {
  if (agent.nodes.length !== 1 || agent.nodes[0].type !== 'goal') return html``;
  const node = agent.nodes[0];
  const tools = node.tools ?? [];
  return html`
    <section class="card goal-card" style="padding: var(--space-4); margin-bottom: var(--space-4);">
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3);">
        <h3 style="margin: 0;">Goal</h3>
        <a class="btn btn--sm" href="/agents/${encodeURIComponent(agent.id)}/nodes/${encodeURIComponent(node.id)}/edit">Edit</a>
      </div>
      <p style="white-space: pre-wrap; margin: var(--space-2) 0 var(--space-3);">${node.goal ?? ''}</p>
      <dl class="kv" style="font-size: var(--font-size-xs); margin: 0;">
        <dt>Tools</dt><dd>${tools.length === 0 ? html`<span class="dim">none</span>` : tools.map((t) => html`<span class="badge badge--muted mono" style="margin-right: var(--space-1);">${t}</span>`) as unknown as SafeHtml[]}</dd>
        <dt>Budget</dt><dd>${String(node.budget?.maxTurns ?? 15)} turns · ${String(node.budget?.timeoutSec ?? 600)} seconds</dd>
      </dl>
    </section>`;
}

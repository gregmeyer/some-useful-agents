import { markdownToText, stripInlineWidgets } from '@some-useful-agents/core';
/**
 * Inbox view-data + in-thread widget boundary.
 *
 * This is the SINGLE place "what the inbox renders for a thread" is assembled:
 * the thread summary, and — most relevant for
 * future work — the inline rendering of agent OUTPUT WIDGETS inside a
 * conversation (`buildInlineActionWidgets` + `INLINE_INBOX_WIDGET_TYPES`, which
 * already allows the `dashboard` widget type). Routes and the detail views call
 * into here; they don't re-derive view data inline.
 *
 * Extension point: to surface dashboard/output widgets in threads more richly
 * (a planned "inbox span of control" capability), widen `INLINE_INBOX_WIDGET_TYPES`
 * and the render path HERE — not in the route file.
 */
import { renderRunView, renderLegacySurface } from '../lib/a2ui-surface.js';
import { legacyWidgetView } from '../lib/legacy-view.js';
import {
  exportAgent,
  unallowedWidgetImageHosts,
  type Agent,
  type InboxResponse,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { html, type SafeHtml } from '../views/html.js';
import { renderOutputWidget } from '../views/output-widgets.js';
import { renderOutcomeRecord } from '../views/outcome-record.js';
import { answersForThread, runPictures } from '../lib/run-pictures.js';
import { NotebookStore } from '@some-useful-agents/core';
import {
  summarizeInline,
  humanInboxStatus,
  parseActionMeta,
  SYSTEM_AGENT_IDS,
} from './inbox-shared.js';

const INLINE_INBOX_WIDGET_TYPES: ReadonlySet<string> = new Set([
  'ai-template',
  'key-value',
  'dashboard',
  'raw',
]);

/** One line of plain text for the summary: Markdown stripped first, so shortening never leaves a half-open `**`. */
function plainSummary(text: string | undefined, max: number): string | undefined {
  return summarizeInline(text ? markdownToText(stripInlineWidgets(text, ' ')) : text, max);
}

/**
 * Derive a thread summary (goal / latest result / next step) purely from the
 * thread's existing responses — no LLM call. The goal is the latest real user
 * ask; the latest result is the most recent completed action / triage / system
 * note; the next step is the most recent still-proposed action. Used by the
 * summary block and the fork/summarize routes.
 */
export function buildThreadSummary(
  message: { title: string; status: string; body: string },
  responses: readonly InboxResponse[],
): { currentGoal: string; latestResult?: string; currentStatus: string; nextStep?: string } {
  let currentGoal = plainSummary(message.title, 140)
    ?? plainSummary(message.body, 140)
    ?? 'Continue the thread';
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const response = responses[i];
    if (response.role !== 'user') continue;
    if (response.body.trim() === '(Asked triage to take another look.)') continue;
    currentGoal = plainSummary(response.body, 140) ?? currentGoal;
    break;
  }

  let latestResult: string | undefined;
  let nextStep: string | undefined;
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const response = responses[i];
    const action = parseActionMeta(response);
    if (!latestResult && action?.status === 'completed') {
      latestResult = plainSummary(action.resultSummary ?? response.body, 180);
    }
    if (!latestResult && (response.role === 'triage' || response.role === 'system')) {
      latestResult = plainSummary(response.body, 180);
    }
    if (!nextStep && action?.status === 'proposed') {
      nextStep = plainSummary(action.rationale ?? `Run ${action.agentId}`, 160);
    }
    if (latestResult && nextStep) break;
  }

  return { currentGoal, latestResult, currentStatus: humanInboxStatus(message.status), nextStep };
}

export function canRenderInlineInboxWidget(agent: Agent | null | undefined): agent is Agent & { outputWidget: NonNullable<Agent['outputWidget']> } {
  if (agent?.view) return true; // an A2UI view renders inline anywhere (docs/a2ui-views.md)
  if (!agent?.outputWidget) return false;
  return INLINE_INBOX_WIDGET_TYPES.has(agent.outputWidget.type);
}

export function renderBlockedInlineWidgetNotice(
  agentId: string,
  messageId: string,
  blockedHosts: readonly string[],
): SafeHtml {
  const forms = blockedHosts.map((host) => html`
    <form method="POST" action="/agents/${agentId}/permissions/allow-host" style="display: inline; margin: 0;">
      <input type="hidden" name="host" value="${host}">
      <input type="hidden" name="redirect" value="/inbox/${messageId}">
      <button type="submit" class="btn btn--xs btn--ghost">Allow ${host}</button>
    </form>
  `);
  return html`
    <div class="flash flash--error" style="margin-top: var(--space-2);">
      <div style="font-size: var(--font-size-xs); margin-bottom: var(--space-2);">
        Inline widget hidden. It references blocked image host${blockedHosts.length === 1 ? '' : 's'}.
      </div>
      <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
        ${forms as unknown as SafeHtml[]}
      </div>
    </div>
  `;
}

export function buildInlineActionWidgets(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  responses: readonly InboxResponse[],
): Record<string, SafeHtml | undefined> {
  const inlineWidgets: Record<string, SafeHtml | undefined> = {};
  for (const response of responses) {
    const meta = parseActionMeta(response);
    if (!meta || meta.status !== 'completed' || !meta.runId) continue;

    // Two independent things can render under one action card: the agent's
    // output widget (what it produced) and its outcome card (whether that
    // was what it was supposed to produce). They're computed separately
    // because either can exist without the other — an agent can declare an
    // `outcome:` block and no widget, or vice versa.
    const widget = renderActionWidget(ctx, messageId, meta);
    const outcome = renderOutcomeCard(ctx, meta.runId);
    const pictures = renderRunPictureTools(ctx, messageId, response.id, meta as { agentId: string; runId: string });
    if (!widget && !outcome && !pictures) continue;
    inlineWidgets[response.id] = html`${widget ?? ''}${pictures ?? ''}${outcome ?? ''}`;
  }
  return inlineWidgets;
}

/**
 * Under a finished run that made a picture: the picture (opens full size),
 * then where it is. In an answer: "In [answer] · Remove". Not yet: one button
 * for the answer the conversation is about, and the others behind "Another
 * answer". A picture sua can't find says why, instead of a broken image.
 */
function renderRunPictureTools(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  responseId: string,
  meta: { agentId: string; runId: string },
): SafeHtml | undefined {
  const pics = runPictures(ctx, meta.agentId, meta.runId);
  if (!pics.length) return undefined;
  let inAnswers: Array<{ id: string; title: string }> = [];
  try {
    const s = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
    const ids = [...new Set(s.picturesFromRun(meta.runId).map((p) => p.notebookId))];
    inAnswers = ids.map((id) => s.get(id)).filter((nb): nb is NonNullable<typeof nb> => !!nb).map((nb) => ({ id: nb.id, title: nb.title }));
  } catch { /* no answers here */ }
  const { linked, others } = pics.some((p) => p.file) ? answersForThread(ctx, messageId) : { linked: [], others: [] };
  const enc = encodeURIComponent;
  const action = (what: string) => `/inbox/${enc(messageId)}/actions/${enc(responseId)}/${what}`;
  const already = new Set(inAnswers.map((a) => a.id));
  const rows = pics.map((p) => {
    if (!p.file) {
      return html`<p class="inbox-action__picture-missing"><strong>It made a picture sua can't show.</strong> It said it saved it at <span class="mono">${p.said}</span>. ${p.why ?? ''}</p>`;
    }
    const src = `/output-file?path=${enc(p.said)}`;
    const shown = html`<a class="inbox-action__picture" href="${src}" target="_blank" rel="noopener" title="Open full size"><img src="${src}" alt="${p.label}" loading="lazy"></a>`;
    const where = inAnswers.map((nb) => html`<form method="POST" action="${action('remove-picture')}" class="inbox-action__keep">
        <input type="hidden" name="notebook" value="${nb.id}">
        <span>In <a href="/notebooks/${enc(nb.id)}">${nb.title}</a></span>
        <button type="submit" class="btn btn--sm btn--ghost">Remove</button>
      </form>`);
    const lead = linked.find((nb) => !already.has(nb.id));
    const rest = [...linked, ...others].filter((nb) => !already.has(nb.id) && nb.id !== lead?.id);
    const addTo = (nb: { id: string; title: string }) => html`<form method="POST" action="${action('add-picture')}" class="inbox-action__keep">
        <input type="hidden" name="field" value="${p.field}"><input type="hidden" name="notebook" value="${nb.id}">
        <button type="submit" class="btn btn--sm">Add to ${nb.title}</button>
      </form>`;
    const another = rest.length ? html`<details class="inbox-action__another"${!lead && !inAnswers.length ? ' open' : ''}>
        <summary>${lead || inAnswers.length ? 'Another answer' : 'Add to an answer'}</summary>
        <form method="POST" action="${action('add-picture')}" class="inbox-action__keep">
          <input type="hidden" name="field" value="${p.field}">
          <select name="notebook" aria-label="Answer to add it to">${rest.map((nb) => html`<option value="${nb.id}">${nb.title}</option>`) as unknown as SafeHtml[]}</select>
          <button type="submit" class="btn btn--sm btn--ghost">Add</button>
        </form>
      </details>` : html``;
    return html`${shown}<div class="inbox-action__keep-row">${where as unknown as SafeHtml[]}${lead ? addTo(lead) : html``}${another}</div>`;
  });
  return html`<div class="inbox-action__pictures">${rows as unknown as SafeHtml[]}</div>`;
}

function renderActionWidget(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  meta: { agentId: string; runId?: string },
): SafeHtml | undefined {
  if (!meta.runId) return undefined;
  const agent = ctx.agentStore.getAgent(meta.agentId);
  if (!canRenderInlineInboxWidget(agent)) return undefined;
  const run = ctx.runStore.getRun(meta.runId);
  if (!run?.result) return undefined;
  if (agent.view) {
    if (run.status !== 'completed') return undefined;
    return renderRunView(agent, run, ctx.runStore.listNodeExecutions(run.id), `inbox-${messageId}-${run.id}`, { runStore: ctx.runStore });
  }

  const blockedHosts = unallowedWidgetImageHosts({
    outputWidget: agent.outputWidget,
    permissions: agent.permissions,
    result: run.result,
  });
  if (blockedHosts.length > 0) {
    return renderBlockedInlineWidgetNotice(agent.id, messageId, blockedHosts);
  }
  // A picture the run made is shown under the widget (renderRunPictureTools), so its link isn't repeated here.
  const shownPictures = new Set(runPictures(ctx, meta.agentId, meta.runId).filter((p) => p.file).map((p) => p.field));
  const widget = shownPictures.size ? { ...agent.outputWidget, fields: (agent.outputWidget.fields ?? []).filter((f) => !shownPictures.has(f.name)) } : agent.outputWidget;
  const surface = renderLegacySurface(`inbox-${messageId}-${run.id}`, legacyWidgetView(widget, run.result), { widget });
  if (surface) return surface;
  return renderOutputWidget(widget, run.result, agent.id);
}

/**
 * Compact outcome card for a completed action run. Delegates to the shared
 * renderer so the thread and the run detail page can never drift apart.
 */
export function renderOutcomeCard(
  ctx: ReturnType<typeof getContext>,
  runId: string,
): SafeHtml | undefined {
  let record;
  try {
    record = ctx.outcomeStore?.get(runId)?.record;
  } catch {
    return undefined;
  }
  if (!record) return undefined;
  return renderOutcomeRecord(record, { variant: 'compact' });
}

/**
 * Export the YAML of the agent referenced by `agentId` (the inbox
 * message's target). The detail view passes this into the diff
 * renderer so `agent-editor` action cards can show old-vs-new.
 * Returns undefined when there's no target or the agent isn't
 * installed — the view falls back to rendering just inputs.
 */
export function exportTargetAgentYaml(
  ctx: ReturnType<typeof getContext>,
  agentId: string | undefined,
): string | undefined {
  if (!agentId) return undefined;
  const target = ctx.agentStore.getAgent(agentId);
  if (!target) return undefined;
  try { return exportAgent(target); } catch { return undefined; }
}

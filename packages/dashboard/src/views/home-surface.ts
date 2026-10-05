/**
 * Home's surface, drawn (goal surfaces, S3): the Today tab (regions of item
 * rows, in the order the surface compiled) and the pane for one item with its
 * actions. Conversations open as threads; other items open here.
 *
 * Mockup: canvas screen 21. A row's id is the thread id for a conversation,
 * else `item:<item id>` (the panel fetches /items/<id>/fragment for those).
 */
import type { CompiledEntry, Item, ItemAction } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { formatAge } from './components.js';
import type { HomeSurface } from '../lib/home-surface.js';

type Dot = 'approve' | 'answer' | 'fail' | undefined;

function dotOf(item: Item): Dot {
  if (item.kind === 'decision') return 'approve';
  if (item.kind === 'question') return 'answer';
  if (item.kind === 'alert') return 'fail';
  return undefined;
}

function tagOf(item: Item): string {
  if (item.id.startsWith('thread:')) return item.kind === 'decision' ? 'Approve' : item.kind === 'question' ? 'Answer' : 'Failing';
  if (item.id.endsWith(':failing')) return `${String(item.value ?? '')}×`;
  if (item.id.endsWith(':outcome')) return 'Missed';
  if (item.id.endsWith(':draft')) return 'Draft';
  if (item.id.startsWith('question:')) return 'Answer';
  if (item.id.startsWith('notebook:')) return String(item.value ?? '');
  if (item.kind === 'progress') return 'Building';
  return '';
}

/** What the row opens: the conversation itself, or the item pane. */
export function rowTarget(item: Item): string {
  if (item.id.startsWith('thread:')) return item.id.slice('thread:'.length);
  if (item.id.startsWith('question:') && item.subject.threadId) return item.subject.threadId;
  return `item:${item.id}`;
}

/**
 * Why a row is where it is, shown on the row when something put it there
 * (a pin, a move, a rule), not when it's simply in urgency order.
 */
function shownWhy(e: CompiledEntry): string {
  const r = e.reasons[0] ?? '';
  return r.startsWith('In ') || r.startsWith('Folded by') ? '' : r;
}

/** A row's ⋯ menu: change where it sits on Home, by hand (S4). */
function rowMenu(e: CompiledEntry): SafeHtml {
  const op = (name: string, label: string) => html`<button type="button" class="inbox-modal__menu-item" data-surface-op="${name}">${label}</button>`;
  return html`
    <details class="panel-row__menu" data-inbox-menu>
      <summary class="panel-row__menu-btn" aria-label="Move or hide “${e.item.title}”" title="Move or hide">⋯</summary>
      <div class="inbox-modal__menu-panel panel-row__menu-list">
        ${e.pinned ? op('unpin', 'Unpin') : op('pin', 'Pin to top')}
        ${e.pinned ? html`` : html`${op('up', 'Move up')}${op('down', 'Move down')}`}
        ${op('dismiss', 'Dismiss')}
        ${op('hide', 'Hide from Home')}
      </div>
    </details>`;
}

function row(e: CompiledEntry, wide: boolean, why = shownWhy(e)): SafeHtml {
  const { item } = e;
  const dot = dotOf(item);
  return html`
    <li class="panel-row ${wide ? 'panel-row--wide' : ''} ${e.pinned ? 'is-pinned' : ''}" data-item-id="${item.id}" data-item-title="${item.title}"${e.pinned ? unsafeHtml(' data-pinned') : unsafeHtml('')} draggable="true">
      <button type="button" class="panel-row__main" data-panel-thread-id="${rowTarget(item)}" title="${e.reasons[0] ?? ''}">
        <span class="panel-row__dot ${dot ? `panel-row__dot--${dot}` : ''}" aria-hidden="true"></span>
        <span class="panel-row__title ${dot && !e.collapsed ? 'is-strong' : ''}">${item.title}</span>
        <span class="panel-row__age">${formatAge(item.provenance.at)}</span>
        <span class="panel-row__latest">${item.summary ?? ''}</span>
        <span class="panel-row__tag ${dot ? `panel-row__tag--${dot}` : ''}">${e.pinned ? html`<span class="panel-row__pin">Pinned</span>` : html``}${tagOf(item)}</span>
        ${why ? html`<span class="panel-row__why">${why}</span>` : html``}
      </button>
      ${rowMenu(e)}
    </li>`;
}

/** "17 draft agents waiting to be made active", or "5 decisions". */
function foldLabel(entries: CompiledEntry[]): string {
  const n = entries.length;
  if (entries.every((e) => e.item.id.endsWith(':draft'))) return `${String(n)} draft agent${n === 1 ? '' : 's'} waiting to be made active`;
  return `${String(n)} × ${entries[0].group ?? 'more'}`;
}

/**
 * Entries, with runs of folded group members drawn as one disclosure. A
 * reason shows on the first row of a run that shares it, not on every row.
 */
function regionRows(entries: CompiledEntry[], wide: boolean): SafeHtml[] {
  const out: SafeHtml[] = [];
  let lastWhy = '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.group && e.collapsed) {
      const run = [e];
      while (i + 1 < entries.length && entries[i + 1].group === e.group && entries[i + 1].collapsed) run.push(entries[++i]);
      const why = run[0].reasons.find((r) => r.startsWith('Folded by')) ?? '';
      out.push(html`
        <li class="panel-fold">
          <details>
            <summary class="panel-fold__summary" title="${why}"><span>${foldLabel(run)}</span></summary>
            <ul class="panel-group__rows">${run.map((x) => row(x, wide)) as unknown as SafeHtml[]}</ul>
          </details>
        </li>`);
      lastWhy = '';
      continue;
    }
    const why = shownWhy(e);
    out.push(row(e, wide, why && why !== lastWhy ? why : ''));
    lastWhy = why;
  }
  return out;
}

/** Things you (or your rules) hid, with the way back. */
function hiddenList(today: HomeSurface): SafeHtml {
  const hidden = today.compiled.hidden.filter((h) => h.by && h.item);
  if (hidden.length === 0) return html``;
  return html`
    <details class="panel-hidden">
      <summary>${String(hidden.length)} hidden from Home</summary>
      <ul class="panel-hidden__list">
        ${hidden.map((h) => html`
          <li class="panel-hidden__row" data-item-id="${h.itemId}" data-item-title="${h.item!.title}">
            <span class="panel-hidden__title">${h.item!.title}<span class="panel-hidden__why">${h.reason}</span></span>
            ${h.by && 'ruleId' in h.by
              ? html`<button type="button" class="btn btn--xs btn--ghost" data-surface-op="remove-rule" data-rule-id="${h.by.ruleId}">Stop this rule</button>`
              : html`<button type="button" class="btn btn--xs btn--ghost" data-surface-op="show">Show</button>`}
          </li>`) as unknown as SafeHtml[]}
      </ul>
    </details>`;
}

/** "3 failing agents · 2 waiting on your reply · 6 drafts folded": why Needs you has what it has. */
export function needsBreakdown(entries: readonly CompiledEntry[]): string {
  const n = (pred: (e: CompiledEntry) => boolean) => entries.filter(pred).length;
  const failing = n((e) => /:(failing|outcome)$/.test(e.item.id) || (e.item.id.startsWith('thread:') && e.item.kind === 'alert'));
  const replies = n((e) => e.item.id.startsWith('thread:') && e.item.kind !== 'alert' || e.item.id.startsWith('question:'));
  const drafts = n((e) => e.item.id.endsWith(':draft'));
  const folded = n((e) => e.collapsed && !e.item.id.endsWith(':draft'));
  const plural = (k: number, one: string, many: string) => `${String(k)} ${k === 1 ? one : many}`;
  return [
    failing ? plural(failing, 'agent problem', 'agent problems') : '',
    replies ? plural(replies, 'waiting on your reply', 'waiting on your reply') : '',
    drafts ? plural(drafts, 'recent draft to look at', 'recent drafts to look at') : '',
    folded ? `${String(folded)} folded` : '',
  ].filter(Boolean).join(' · ') || 'Nothing urgent';
}

/** The Today tab: Needs you and Happening now as rows, All good as quiet lines. */
export function renderToday(today: HomeSurface, wide: boolean): SafeHtml {
  return html`<div class="panel-today" data-surface="home" data-surface-version="${String(today.version)}">${todayBody(today, wide)}${hiddenList(today)}</div>`;
}

function todayBody(today: HomeSurface, wide: boolean): SafeHtml {
  const regions = today.compiled.regions.filter((r) => r.entries.length > 0);
  if (regions.every((r) => r.id === 'all-good')) {
    return html`<p class="panel-home__empty">Nothing needs you right now.</p>${allGood(regions.find((r) => r.id === 'all-good')?.entries ?? [])}`;
  }
  return html`
    ${regions.filter((r) => r.id !== 'all-good').map((r) => html`
      <section class="panel-group" data-surface-region="${r.id}">
        <h3 class="panel-group__label">${r.title}</h3>
        ${r.id === 'needs-you' ? html`<p class="panel-group__why">${needsBreakdown(r.entries)}</p>` : html``}
        <ul class="panel-group__rows" data-panel-group>${regionRows(r.entries, wide) as unknown as SafeHtml[]}</ul>
        ${r.more ? html`<p class="panel-home__morecount">${String(r.more)} more</p>` : html``}
      </section>`) as unknown as SafeHtml[]}
    ${allGood(regions.find((r) => r.id === 'all-good')?.entries ?? [])}`;
}

function allGood(entries: CompiledEntry[]): SafeHtml {
  if (entries.length === 0) return html``;
  return html`<div class="panel-allgood" data-surface-region="all-good">${entries.map((e) => html`<p><span class="panel-allgood__label">All good:</span> ${e.item.summary ?? e.item.title}</p>`) as unknown as SafeHtml[]}</div>`;
}

/** Run and build ids are long hashes: show 8 characters. Names stay whole. */
const shortRef = (kind: string, id: string): string => (kind === 'run' || kind === 'build' || kind === 'outcome' ? id.slice(0, 8) : id);

const SOURCE_LABEL: Record<Item['provenance']['source'], string> = {
  inbox: 'from your inbox', questions: 'a run is waiting on you', runs: 'from its runs', outcomes: 'from its outcome check',
  scheduler: 'the scheduler', 'board-builds': 'a board build', agents: 'your agents', notebooks: 'a notebook',
};

function actionControl(a: ItemAction, primary: boolean, item: Item): SafeHtml {
  const cls = primary ? 'btn btn--sm btn--primary' : 'btn btn--sm btn--ghost';
  switch (a.type) {
    case 'retry':
      return html`<form method="POST" action="/agents/${encodeURIComponent(a.agentId)}/run" data-item-act data-item-done="Started a run. Its result shows here and on the agent's page." class="item-pane__form"><button type="submit" class="${cls}">${a.label}</button></form>`;
    case 'activate':
      return html`<form method="POST" action="/scheduled/${encodeURIComponent(a.agentId)}/activate" data-item-act data-item-resolves data-item-done="It's active now, so it's off Today." class="item-pane__form"><button type="submit" class="${cls}">${a.label}</button></form>`;
    case 'reply':
      return html`<button type="button" class="${cls}" data-panel-thread-id="${a.threadId}">${a.label}</button>`;
    case 'answer':
      return item.subject.threadId
        ? html`<button type="button" class="${cls}" data-panel-thread-id="${item.subject.threadId}">${a.label}</button>`
        : html`<a class="${cls}" href="/runs/${encodeURIComponent(item.subject.runId ?? '')}">${a.label}</a>`;
    case 'open':
      return html`<a class="${cls}" href="${a.href}">${a.label}</a>`;
    default:
      return html``;
  }
}

/** One item: what it is, its evidence, what you can do, and why it's on Home. */
export function renderItemPane(entry: CompiledEntry | undefined, itemId: string): SafeHtml {
  if (!entry) {
    return html`<article class="item-pane"><p class="item-pane__gone">This isn't on Home any more: it was handled, or it changed.</p></article>`;
  }
  const { item } = entry;
  const actions: ItemAction[] = [...item.actions];
  // An agent problem with no conversation yet: offer one.
  const askFix = (item.id.endsWith(':failing') || item.id.endsWith(':outcome')) && !item.subject.threadId && item.subject.agentId;
  const controls: SafeHtml[] = actions.map((a, i) => actionControl(a, i === 0, item));
  if (askFix) {
    controls.splice(1, 0, html`<form method="POST" action="/agents/${encodeURIComponent(item.subject.agentId!)}/ask-fix" data-ask-fix class="item-pane__form"><button type="submit" class="btn btn--sm btn--ghost">Ask sua to fix it</button></form>`);
  }
  return html`
    <article class="item-pane" data-item-pane data-item-id="${itemId}">
      <div class="item-pane__meta">
        <span class="item-pane__kind item-pane__kind--${item.kind}">${item.kind}</span>
        <span>${SOURCE_LABEL[item.provenance.source]}</span>
        <span>· ${formatAge(item.provenance.at)}</span>
      </div>
      <h2 class="item-pane__title">${item.title}</h2>
      ${item.summary ? html`<p class="item-pane__body">${item.summary}</p>` : html``}
      ${item.evidence.length ? html`
        <div class="item-pane__evidence">
          <span class="item-pane__label">Evidence</span>
          <div class="item-pane__chips">${item.evidence.map((ev) => ev.href
            ? html`<a class="item-pane__chip mono" href="${ev.href}">${ev.kind} ${shortRef(ev.kind, ev.id)}</a>`
            : html`<span class="item-pane__chip mono">${ev.kind} ${shortRef(ev.kind, ev.id)}</span>`) as unknown as SafeHtml[]}</div>
        </div>` : html``}
      <div class="item-pane__actions">${controls as unknown as SafeHtml[]}<button type="button" class="btn btn--sm btn--ghost" data-item-dismiss title="Off Today until something new happens to it">Dismiss</button></div>
      <p class="item-pane__status" data-item-status role="status" aria-live="polite"></p>
      <section class="item-pane__why" aria-label="Why it's here">
        <span class="item-pane__label">Why it's here</span>
        <ul>${entry.reasons.map((r) => html`<li>${r}</li>`) as unknown as SafeHtml[]}</ul>
      </section>
    </article>`;
}

/** "· arranged by the defaults" / "· arranged by your rules, v3". The client keeps it current. */
export function arrangedBy(version: number): string {
  return version === 0 ? 'Arranged by the defaults' : `Arranged by your rules, v${String(version)}`;
}

/** Home's history, newest first: who changed what and why, with the way back. */
export function renderSurfaceHistory(versions: Array<{ version: number; who: string; reason: string; changes: string[] }>, current: number): SafeHtml {
  if (current === 0) {
    return html`<p class="home-history__empty">Home is arranged by the defaults; nothing has changed yet. Pin, move or hide on Today, or ask sua to change Home.</p>`;
  }
  return html`
    <ol class="home-history__list">
      ${versions.map((v) => html`
        <li class="home-history__row">
          <div class="home-history__head">
            <span class="home-history__v mono">v${String(v.version)}</span>
            <span class="home-history__who">${v.who}</span>
            ${v.version === current
              ? html`<button type="button" class="btn btn--xs btn--ghost" data-surface-restore="${String(v.version - 1)}">Undo</button>`
              : html`<button type="button" class="btn btn--xs btn--ghost" data-surface-restore="${String(v.version)}">Go back to this</button>`}
          </div>
          <p class="home-history__reason">${v.reason}</p>
          ${v.changes.length ? html`<ul class="home-history__changes">${v.changes.map((c) => html`<li>${c}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
        </li>`) as unknown as SafeHtml[]}
      <li class="home-history__row home-history__row--base">
        <div class="home-history__head">
          <span class="home-history__v mono">v0</span><span class="home-history__who">The defaults</span>
          <button type="button" class="btn btn--xs btn--ghost" data-surface-restore="0">Go back to the defaults</button>
        </div>
      </li>
    </ol>`;
}

/** Home's goal, as a quiet subtitle under the title. */
export function renderHomeGoal(today: HomeSurface): SafeHtml {
  return html`<p class="home-head__goal">${today.goal}</p>`;
}

/** Adjust Home ▾: ask sua to change it, how it's arranged, and what changed (with Undo). */
export function renderHomeAdjust(today: HomeSurface): SafeHtml {
  return html`
    <details class="home-adjust">
      <summary class="btn btn--sm home-adjust__btn">Adjust Home</summary>
      <div class="home-adjust__panel">
        <form method="POST" action="/surfaces/home/ask" class="home-change" data-ask-fix>
          <label class="home-change__label" for="home-change-text">Ask sua to change what Home shows</label>
          <div class="home-change__row">
            <input type="text" id="home-change-text" name="text" class="home-change__input" required autocomplete="off"
              placeholder="e.g. put failing agents first, hide the drafts">
            <button type="submit" class="btn btn--sm btn--primary">Ask sua</button>
          </div>
        </form>
        <div class="home-adjust__meta">
          <span class="home-goal__by" data-surface-by>${arrangedBy(today.version)}</span>
          <button type="button" class="home-goal__history" data-surface-history aria-expanded="false">What changed</button>
        </div>
        <div class="home-history" data-surface-history-panel hidden></div>
      </div>
    </details>`;
}

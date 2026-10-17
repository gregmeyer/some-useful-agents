/**
 * Widgets inside a chat reply (docs/a2ui-views.md, "In chat"): a reply can
 * carry `<a2ui>{"components": [...], "data": {...}}</a2ui>` blocks between its
 * text. The dashboard draws each block, validated like any view, in place of
 * the block; while the reply streams, the components that are already
 * complete are drawn as they arrive (`partialInlineWidget`).
 */
import { suaComponentDocs } from './catalog.js';
import { extractGeneratedView, validateViewComponents, type ViewComponent } from './view.js';

export type ReplyPart = { kind: 'text'; text: string } | { kind: 'widget'; raw: string };

const BLOCK_RE = /<a2ui>([\s\S]*?)<\/a2ui>/gi;

/** A reply split into its text and its widget blocks, in order. */
export function splitReply(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let last = 0;
  for (const m of text.matchAll(BLOCK_RE)) {
    const before = text.slice(last, m.index);
    if (before.trim()) parts.push({ kind: 'text', text: before });
    parts.push({ kind: 'widget', raw: m[1] });
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = text.slice(last);
  if (rest.trim()) parts.push({ kind: 'text', text: rest });
  return parts;
}

/** The reply with each widget block replaced by a short note (for history and plain-text places). */
export function stripInlineWidgets(text: string, note = '(a widget)'): string {
  return text.replace(BLOCK_RE, note);
}

/** Ids a component names as its children. */
function childIdsOf(c: ViewComponent): string[] {
  const out: string[] = [];
  const add = (v: unknown) => { if (typeof v === 'string') out.push(v); };
  add(c.child);
  if (Array.isArray(c.children)) c.children.forEach(add);
  if (Array.isArray(c.tabs)) for (const t of c.tabs as Array<{ child?: unknown }>) add(t?.child);
  return out;
}

/**
 * Check each component on its own and swap the ones that don't check out for
 * a short note (a container keeps its children as a plain Column), so one
 * wrong property doesn't lose the whole widget. Missing children become "…".
 */
export function repairComponents(list: unknown[], imgHosts: string[] = []): { components: ViewComponent[]; dropped: string[] } {
  const comps = list.filter((c): c is ViewComponent => !!c && typeof c === 'object' && typeof (c as ViewComponent).id === 'string' && typeof (c as ViewComponent).component === 'string');
  const ids = new Set(comps.map((c) => c.id));
  const dropped: string[] = [];
  const out = comps.map((c) => {
    const kids = childIdsOf(c);
    const probeRoot = c.id === 'root' ? [] : [{ id: 'root', component: 'Column', children: [c.id] } as ViewComponent];
    const probeKids = kids.filter((k) => k !== 'root').map((k) => ({ id: k, component: 'Text', text: '…' } as ViewComponent));
    if (validateViewComponents([...probeRoot, c, ...probeKids], { imgHosts }).ok) return c;
    dropped.push(c.component);
    return kids.length > 0
      ? ({ id: c.id, component: 'Column', children: kids } as ViewComponent)
      : ({ id: c.id, component: 'Text', text: `(a ${c.component} that couldn't be drawn)`, variant: 'caption' } as ViewComponent);
  });
  for (const c of [...out]) {
    for (const k of childIdsOf(c)) if (!ids.has(k)) { ids.add(k); out.push({ id: k, component: 'Text', text: '…', variant: 'caption' } as ViewComponent); }
  }
  return { components: out, dropped };
}

/** A complete widget block, checked: components and the data they bind to at `/data`. */
export function parseInlineWidget(raw: string, imgHosts: string[] = []): { components: ViewComponent[]; data: unknown; dropped?: string[] } | { error: string } {
  const v = extractGeneratedView(raw.trim());
  if (!v || !Array.isArray(v.components)) return { error: "it isn't a component list" };
  const checked = validateViewComponents(v.components, { imgHosts });
  if (checked.ok) return { components: checked.components, data: v.data ?? {} };
  // Keep what checks out: one wrong property shouldn't lose the whole widget.
  const repaired = repairComponents(v.components, imgHosts);
  const again = validateViewComponents(repaired.components, { imgHosts });
  if (again.ok && repaired.components.some((c) => c.id === 'root')) return { components: again.components, data: v.data ?? {}, dropped: repaired.dropped };
  return { error: checked.errors[0] ?? 'invalid' };
}

/**
 * The complete top-level objects of the JSON array that starts at `from`
 * (string-aware brace matching), and whether the array is closed.
 */
function completeObjects(text: string, from: number): { objects: string[]; closed: boolean } {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') {
      if (depth === 0 && ch === '{') start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && ch === '}' && start >= 0) { objects.push(text.slice(start, i + 1)); start = -1; }
      if (depth < 0) return { objects, closed: true };
    }
  }
  return { objects, closed: false };
}


/**
 * The widget a reply is in the middle of writing: the last `<a2ui>` block
 * that hasn't closed. Returns the components complete so far (children not
 * written yet stand in as "…"), validated, or undefined when there's nothing
 * to draw yet. `count` is how many components are real (to skip redraws).
 */
export function partialInlineWidget(text: string, imgHosts: string[] = []): { index: number; components: ViewComponent[]; count: number } | undefined {
  const open = text.lastIndexOf('<a2ui>');
  if (open < 0 || text.indexOf('</a2ui>', open) >= 0) return undefined;
  const index = (text.slice(0, open).match(/<a2ui>/gi) ?? []).length;
  const body = text.slice(open + '<a2ui>'.length);
  const key = body.indexOf('"components"');
  const arrayAt = key >= 0 ? body.indexOf('[', key) : body.trimStart().startsWith('[') ? body.indexOf('[') : -1;
  if (arrayAt < 0) return undefined;
  const { objects } = completeObjects(body, arrayAt + 1);
  const real: ViewComponent[] = [];
  for (const o of objects) {
    try {
      const c = JSON.parse(o) as ViewComponent;
      if (c && typeof c.id === 'string' && typeof c.component === 'string') real.push(c);
    } catch { /* not complete JSON after all */ }
  }
  if (!real.some((c) => c.id === 'root')) return undefined;
  // Children not written yet stand in as "…"; a part that doesn't check out as a note.
  const { components } = repairComponents(real, imgHosts);
  const checked = validateViewComponents(components, { imgHosts });
  return checked.ok ? { index, components: checked.components, count: real.length } : undefined;
}

/**
 * The components a reply's widget can use, one example each (so the model
 * sees each one's real properties), bound under /data. Shared by the chat
 * agents' guide and sua's (inbox-triage kernel): one list for every conversation.
 */
export function replyWidgetComponents(): string {
  const examples = suaComponentDocs()
    .filter((d) => !['OptionGrid', 'Coverage', 'Checklist', 'Steps', 'Timeline', 'SanitizedHtml', 'Scatter', 'Funnel', 'Code'].includes(d.name))
    // Catalog examples bind notebook or run paths; in a reply everything is under /data.
    .map((d) => `  ${JSON.stringify(d.example).replace(/"\/(notebook|outputs|series|inputs)\//g, '"/data/')}`)
    .join('\n');
  return `- Components: Text (text, variant: h3 / body / caption), Row and Column (children: [ids]), Card (child), Divider, Button (child: a Text id; action {"event":{"name":"pick","context":{"message":"what clicking says"}}}), and these, used exactly as shown (bind with {"path":"/data/..."}):
${examples}
- A Button's click is sent as the person's next message (its context.message). Buttons are good answers to a question you ask: a few likely answers (which weekend, which of these), each a Button whose message is that answer. Once the person replies, the buttons are spent.`;
}

/** What a chat agent is told about widgets (dashboard chat only: other places can't draw them). */
export function chatWidgetGuide(): string {
  return `WIDGETS IN YOUR REPLY (this chat can draw them):
When it helps the person read your answer (several numbers, a comparison, a list of items with the same fields) or answer you (choices to pick from), add a widget to the reply you write for them:
<a2ui>{"components":[{"id":"root","component":"Column","children":["t"]},{"id":"t","component":"Table","rows":{"path":"/data/rows"},"columns":[{"key":"name","label":"Name"},{"key":"price","label":"Price"}]}],"data":{"rows":[{"name":"A","price":"$10"}]}}</a2ui>
- Put the values in "data" and bind to them with {"path":"/data/..."}. Valid JSON, ids unique, "root" first.
${replyWidgetComponents()}
- Keep the words: one short sentence before the widget. Plain text is better for a short answer, an explanation or a single number.
- Only in the reply the person reads, never in data you pass to another step.`;
}

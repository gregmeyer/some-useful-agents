import { html, type SafeHtml } from './html.js';

/**
 * A tiny, server-rendered picture of an agent's DAG.
 *
 * The shape of an agent — is it a chain? does it fan out? does something only
 * sometimes run? — was previously only visible after opening the agent and
 * finding the Nodes tab or running it. That's several clicks past the moment
 * someone is deciding whether this agent is what they want.
 *
 * Deliberately NOT cytoscape: this renders inline SVG with no JS, so it works
 * in a list of twenty cards without twenty graph engines. It shows structure,
 * not detail — no labels beyond a title, because at this size labels are
 * illegible and the point is the silhouette.
 */

export interface MiniDagNode {
  id: string;
  dependsOn?: string[];
  /** Runs only when a predicate holds — drawn dashed. */
  conditional?: boolean;
  /** Node type, e.g. 'llm-prompt' / 'shell'. Shown on hover. */
  type?: string;
  /** Builtin tool ids this node may call. Shown on hover. */
  tools?: string[];
  /** Human-readable guard, e.g. "judge.verdict = YES". Shown on hover. */
  condition?: string;
}

const NODE_R = 5;
/** Invisible hover target — a 5px dot is a mean thing to ask a mouse to hit. */
const HIT_R = 11;
const COL_W = 46;
const ROW_H = 26;
const PAD = 10;
/** Beyond this the silhouette turns to mush; we summarize instead. */
const MAX_NODES = 12;

interface Placed {
  id: string;
  x: number;
  y: number;
  conditional: boolean;
  node: MiniDagNode;
}

/**
 * The hover text for one node. Native SVG `<title>` — no JS, no tooltip
 * library, and screen readers pick it up as the element's accessible name.
 */
function nodeTooltip(n: MiniDagNode, order: number): string {
  const bits = [`${order}. ${n.id}`];
  if (n.type) bits.push(n.type);
  if (n.tools?.length) bits.push(`tools: ${n.tools.join(', ')}`);
  if (n.conditional) bits.push(n.condition ? `runs only if ${n.condition}` : 'runs conditionally');
  const deps = n.dependsOn ?? [];
  if (deps.length > 0) bits.push(`after ${deps.join(' + ')}`);
  else bits.push('starts the run');
  return bits.join(' · ');
}

/**
 * Assign each node to a column by longest-path depth, so an edge always points
 * strictly rightward and the drawing never doubles back. Nodes sharing a
 * column are stacked, which is exactly what makes a fan-out read as a fan-out.
 */
function layout(nodes: MiniDagNode[]): { placed: Placed[]; width: number; height: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();

  const depthOf = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    // Cycle guard: agent YAML is validated as a DAG upstream, but this view
    // must never hang on malformed input.
    if (seen.has(id)) return 0;
    seen.add(id);
    const node = byId.get(id);
    const deps = (node?.dependsOn ?? []).filter((d) => byId.has(d));
    const d = deps.length === 0 ? 0 : Math.max(...deps.map((p) => depthOf(p, seen))) + 1;
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) depthOf(n.id, new Set());

  const columns = new Map<number, MiniDagNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(n);
  }

  const maxRows = Math.max(...[...columns.values()].map((c) => c.length));
  const colCount = columns.size;
  const width = PAD * 2 + Math.max(1, colCount - 1) * COL_W + NODE_R * 2;
  const height = PAD * 2 + Math.max(1, maxRows - 1) * ROW_H + NODE_R * 2;

  const placed: Placed[] = [];
  for (const [d, group] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    group.forEach((n, i) => {
      // Center each column vertically so a 1-node column sits level with the
      // middle of a 2-node column instead of hugging the top.
      const offset = (maxRows - group.length) * ROW_H / 2;
      placed.push({
        id: n.id,
        x: PAD + NODE_R + d * COL_W,
        y: PAD + NODE_R + offset + i * ROW_H,
        conditional: Boolean(n.conditional),
        node: n,
      });
    });
  }
  return { placed, width, height };
}

/**
 * Render the DAG as inline SVG. Returns an empty fragment for a single-node
 * agent — one dot communicates nothing worth the space.
 */
export function miniDag(nodes: MiniDagNode[], opts: { title?: string } = {}): SafeHtml {
  if (nodes.length < 2) return html``;

  if (nodes.length > MAX_NODES) {
    return html`<div class="mini-dag mini-dag--summary">${nodes.length} steps</div>`;
  }

  const { placed, width, height } = layout(nodes);
  const pos = new Map(placed.map((p) => [p.id, p]));
  const ids = new Set(nodes.map((n) => n.id));

  const edges = nodes.flatMap((n) =>
    (n.dependsOn ?? [])
      .filter((dep) => ids.has(dep) && pos.has(dep) && pos.has(n.id))
      .map((dep) => {
        const a = pos.get(dep)!;
        const b = pos.get(n.id)!;
        const conditional = Boolean(n.conditional);
        return html`<line x1="${a.x + NODE_R}" y1="${a.y}" x2="${b.x - NODE_R}" y2="${b.y}"
          class="mini-dag__edge ${conditional ? 'mini-dag__edge--cond' : ''}" />`;
      }),
  );

  // Execution order for the tooltip's "1." prefix — column-major, which is
  // the order the executor actually reaches them.
  const order = new Map(placed.map((p, i) => [p.id, i + 1]));

  const dots = placed.map((p) => html`
    <g class="mini-dag__hit">
      <circle cx="${p.x}" cy="${p.y}" r="${NODE_R}"
        class="mini-dag__node ${p.conditional ? 'mini-dag__node--cond' : ''}" />
      <circle cx="${p.x}" cy="${p.y}" r="${HIT_R}" class="mini-dag__hitarea">
        <title>${nodeTooltip(p.node, order.get(p.id) ?? 0)}</title>
      </circle>
    </g>
  `);

  // aria-label carries the shape for screen readers; the SVG itself is
  // decorative detail they don't need read out dot by dot.
  const label = opts.title ?? `${nodes.length} steps`;

  return html`
    <svg class="mini-dag" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
      role="img" aria-label="${label}" focusable="false">
      ${edges as unknown as SafeHtml[]}
      ${dots as unknown as SafeHtml[]}
    </svg>
  `;
}

/** Human-readable shape summary, e.g. "4 steps · 2 in parallel · 1 conditional". */
export function describeDag(nodes: MiniDagNode[]): string {
  const parts = [`${nodes.length} step${nodes.length === 1 ? '' : 's'}`];

  const depsKey = (n: MiniDagNode) => JSON.stringify([...(n.dependsOn ?? [])].sort());
  const groups = new Map<string, number>();
  for (const n of nodes) {
    if ((n.dependsOn?.length ?? 0) === 0) continue;
    const k = depsKey(n);
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  const widest = Math.max(1, ...groups.values());
  if (widest > 1) parts.push(`${widest} in parallel`);

  const conditional = nodes.filter((n) => n.conditional).length;
  if (conditional > 0) parts.push(`${conditional} conditional`);

  return parts.join(' · ');
}

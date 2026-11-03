/**
 * What an answer shows besides its words: its diagrams, laid out here from
 * the answer's own numbers (the page and the brief draw them as plain HTML,
 * so they take the page's colours, light or dark, and print), and a small
 * cover picture of what the question is about, drawn in code like an
 * option's illustration (a model's SVG was a box with two circles).
 */
import { answerDiagramLines, diagramParamWords, type Notebook, type NotebookAnswerDiagram, type NotebookDiagramParam } from '@some-useful-agents/core';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => Math.round(n * 1000) / 10;

/**
 * A diagram ready to draw: where each bar goes (in % of the width), its
 * words, and its text version. One with what-ifs (`params`) also carries
 * its `source`, the diagram as written, so the page can recompute and lay
 * it out again in the browser (assets/diagram-math.js, the same arithmetic)
 * as the reader moves a value; each param says its value in words.
 */
export type AnswerDiagramView = (
  | { type: 'ladder'; axis: Array<{ at: number; label: string }>; rungs: Array<{ label: string; left: number; width: number; note: string }>; lines: string[] }
  | { type: 'split'; total: string; parts: Array<{ label: string; width: number; amount: string; note?: string }>; lines: string[] }
  | { type: 'flow'; nodes: Array<{ label: string; note?: string }>; lines: string[] }
) & { source?: NotebookAnswerDiagram; params?: Array<NotebookDiagramParam & { words: string }> };

/** A ladder's month marks: 0, a few round steps, the last end. */
function monthTicks(max: number): number[] {
  const step = [1, 3, 6, 12, 24, 60].find((s) => max / s <= 6) ?? 120;
  const out: number[] = [];
  for (let m = 0; m < max; m += step) out.push(m);
  return [...out, max];
}

const monthWords = (m: number) => (m === 0 ? 'Now' : m % 12 === 0 ? `${String(m / 12)} yr` : `${String(m)} mo`);

/** Lays out a diagram; one with what-ifs carries its source and params too. Pure. */
export function answerDiagramView(d: NotebookAnswerDiagram): AnswerDiagramView {
  const view = layoutDiagram(d);
  const params = d.type !== 'flow' ? d.params : undefined;
  return params?.length ? { ...view, source: d, params: params.map((p) => ({ ...p, words: diagramParamWords(p.key, p.value) })) } : view;
}

/** Where each bar goes. Mirrored in assets/diagram-math.js; a test keeps the two the same. */
function layoutDiagram(d: NotebookAnswerDiagram): AnswerDiagramView {
  const lines = answerDiagramLines(d);
  if (d.type === 'ladder') {
    const max = Math.max(...d.rungs.map((r) => r.end));
    return {
      type: 'ladder', lines,
      axis: monthTicks(max).map((m) => ({ at: pct(m / max), label: monthWords(m) })),
      rungs: d.rungs.map((r) => ({
        label: r.label, left: pct(r.start / max), width: Math.max(2, pct((r.end - r.start) / max)),
        note: [r.amount !== undefined ? money(r.amount) : '', r.rate ?? '', `due ${monthWords(r.end).replace('Now', '0 mo')}`].filter(Boolean).join(' · '),
      })),
    };
  }
  if (d.type === 'split') {
    const sum = d.parts.reduce((t, p) => t + p.amount, 0);
    return {
      type: 'split', lines, total: money(d.total ?? sum),
      parts: d.parts.map((p) => ({ label: p.label, width: pct(p.amount / sum), amount: money(p.amount), ...(p.note ? { note: p.note } : {}) })),
    };
  }
  return { type: 'flow', lines, nodes: d.nodes };
}

export type AnswerArtKind = 'money' | 'home' | 'health' | 'travel' | 'tech' | 'learning' | 'thing';

/** What a question is about, from its words. */
export function answerArtKind(nb: Pick<Notebook, 'title' | 'statement'>): AnswerArtKind {
  const s = `${nb.title} ${nb.statement}`.toLowerCase();
  if (/\b(cds?|certificates?|invest\w*|savings?|save|retire\w*|budget\w*|money|bonds?|stocks?|fund|funds|ira|401k|loan|mortgage|tax\w*|interest|apy|bank\w*|debt|insurance)\b|\$\s?\d/.test(s)) return 'money';
  if (/\b(house|home|apartment|rent\w*|move|moving|condo|renovat\w*|garden)\b/.test(s)) return 'home';
  if (/\b(health|doctor|diet|sleep|fitness|exercise|medical|therapy|nutrition)\b/.test(s)) return 'health';
  if (/\b(trip|travel|flight|hotel|vacation|holiday|visit)\b/.test(s)) return 'travel';
  if (/\b(software|apps?|laptop|computer|ai|crm|saas|tool|tools|code|data|notes?|note-taking|notion|obsidian|logseq|productivity|phone|tablet|website)\b/.test(s)) return 'tech';
  if (/\b(learn\w*|course|school|study|class|degree|book|read)\b/.test(s)) return 'learning';
  return 'thing';
}

/** Flat drawings on a 160×120 board, in the accent's teal and warm stone (DESIGN.md: no gradients, colour rare). */
function cover(kind: AnswerArtKind): string {
  const teal = '#0f9f8f';
  const deep = '#0b6b61';
  const stone = '#d6d3d1';
  const ink = '#44403c';
  switch (kind) {
    case 'money': return `
      <rect x="28" y="84" width="22" height="16" rx="2" fill="${stone}"/><rect x="58" y="70" width="22" height="30" rx="2" fill="${stone}"/>
      <rect x="88" y="54" width="22" height="46" rx="2" fill="${teal}"/><rect x="118" y="36" width="22" height="64" rx="2" fill="${deep}"/>
      <ellipse cx="52" cy="40" rx="18" ry="6" fill="${teal}"/><rect x="34" y="34" width="36" height="6" fill="${teal}"/><ellipse cx="52" cy="34" rx="18" ry="6" fill="${deep}"/>
      <text x="52" y="38" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" font-weight="700" fill="#fff">$</text>
      <path d="M24 104 H144" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`;
    case 'home': return `
      <path d="M40 58 L80 28 L120 58" fill="none" stroke="${deep}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
      <rect x="50" y="56" width="60" height="44" fill="${teal}"/><rect x="72" y="74" width="16" height="26" fill="${deep}"/>
      <path d="M24 104 H136" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`;
    case 'health': return `
      <path d="M80 98 C 40 72, 34 46, 52 36 C 64 30, 76 36, 80 46 C 84 36, 96 30, 108 36 C 126 46, 120 72, 80 98 Z" fill="${teal}"/>
      <path d="M50 62 H66 L72 50 L82 76 L90 62 H110" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
    case 'travel': return `
      <rect x="48" y="44" width="64" height="52" rx="6" fill="${teal}"/><path d="M66 44 V36 Q66 30 72 30 H88 Q94 30 94 36 V44" fill="none" stroke="${deep}" stroke-width="5"/>
      <path d="M48 62 H112" stroke="${deep}" stroke-width="4"/><circle cx="60" cy="100" r="4" fill="${ink}"/><circle cx="100" cy="100" r="4" fill="${ink}"/>`;
    case 'tech': return `
      <rect x="40" y="30" width="80" height="54" rx="4" fill="${ink}"/><rect x="46" y="36" width="68" height="42" rx="2" fill="${stone}"/>
      <path d="M46 70 L66 54 L80 64 L96 48 L114 62 V78 H46 Z" fill="${teal}"/><path d="M28 90 H132 L126 98 H34 Z" fill="${deep}"/>`;
    case 'learning': return `
      <path d="M80 40 Q60 30 34 34 V94 Q60 90 80 100 Z" fill="${teal}"/><path d="M80 40 Q100 30 126 34 V94 Q100 90 80 100 Z" fill="${deep}"/>
      <path d="M42 48 Q58 46 72 52 M42 60 Q58 58 72 64 M88 52 Q102 46 118 48 M88 64 Q102 58 118 60" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    default: return `
      <path d="M50 46 L80 30 L110 46 V86 L80 102 L50 86 Z" fill="${teal}"/><path d="M50 46 L80 62 L110 46 M80 62 V102" fill="none" stroke="${deep}" stroke-width="3" stroke-linejoin="round"/>`;
  }
}

/** The cover as an image address (a data: URL of SVG text, no script, no outside refs), with its words. */
export function answerCover(nb: Pick<Notebook, 'title' | 'statement'>): { src: string; alt: string } {
  const kind = answerArtKind(nb);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" role="img" aria-label="A drawing for ${kind === 'thing' ? 'the question' : kind}"><rect width="160" height="120" rx="10" fill="#f5f5f4"/>${cover(kind)}</svg>`;
  return { src: `data:image/svg+xml;base64,${Buffer.from(svg.replace(/\s+/g, ' ')).toString('base64')}`, alt: '' };
}

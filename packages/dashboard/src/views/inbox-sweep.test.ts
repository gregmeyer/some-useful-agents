import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sameAnswerRepeats } from './home-surface.js';

// The inbox cleanup's last pass: one answer is one row in Today, the inbox has
// no pill shapes, and the answer page's ask card steps aside while the drawer is open.
const entry = (id: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ item: { id, kind: 'decision', title, subject: {}, provenance: { at: new Date().toISOString() } }, reasons: [], ...extra }) as never;

describe('the same answer in Today', () => {
  it('keeps the first row and folds the rest under it; other rows are untouched', () => {
    const a1 = entry('thread:1', 'Answer: Headphones for flights');
    const chat = entry('thread:2', 'what failed?');
    const a2 = entry('thread:3', 'Answer: Headphones for flights');
    const a3 = entry('thread:4', 'Answer: headphones for flights');
    const other = entry('thread:5', 'Answer: Kitchen gifts');
    const { repeats, later } = sameAnswerRepeats([a1, chat, a2, a3, other]);
    expect(repeats.get(a1)).toEqual([a2, a3]);
    expect([...later]).toEqual([a2, a3]);
    expect(repeats.has(other)).toBe(false);
    expect(later.has(chat)).toBe(false);
  });

  it('leaves rows already in a folded group alone', () => {
    const a1 = entry('thread:1', 'Answer: X');
    const a2 = entry('thread:2', 'Answer: X', { group: 'answers', collapsed: true });
    expect(sameAnswerRepeats([a1, a2]).later.size).toBe(0);
  });
});

describe('the inbox styles', () => {
  const css = (f: string) => readFileSync(fileURLToPath(new URL(`../assets/${f}`, import.meta.url)), 'utf8');
  it('has no pill shapes and no rules for markup that is gone', () => {
    const inbox = css('inbox.css');
    expect(inbox).not.toContain('999px');
    expect(inbox).not.toMatch(/\.(panel-row__tag|panel-row__why|panel-group__why|inbox-agent-chip|thread-status|thread-starred)\b/);
  });
  it("the conversation's header scrolls with it; the reply field has no ring of its own", () => {
    const inbox = css('inbox.css');
    const header = inbox.slice(inbox.indexOf('.inbox-detail__header {'), inbox.indexOf('}', inbox.indexOf('.inbox-detail__header {')));
    expect(header).not.toContain('sticky');
    expect(inbox).toMatch(/\.inbox-chatbar textarea:focus \{[^}]*box-shadow: none/);
  });
  it("an answer's ask card steps aside while the sua drawer is open", () => {
    expect(css('notebooks.css')).toMatch(/body\.has-sua-panel \[data-nb-askcard\] \{ display: none; \}/);
  });
  it('with the drawer open the answer takes the full width; the Sources rail follows it', () => {
    const nb = css('notebooks.css');
    expect(nb).toContain('body.has-sua-panel .nb-body { grid-template-columns: minmax(0, 1fr); }');
    expect(nb).toContain('body.has-sua-panel .nb-body__side { position: static; }');
  });
  it("a briefing's cover name wraps inside its column", () => {
    expect(css('a2ui-sua.js')).toMatch(/\.cover \.name \{[^}]*overflow-wrap: break-word/);
  });
});

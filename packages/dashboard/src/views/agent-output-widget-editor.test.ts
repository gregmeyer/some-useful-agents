/**
 * The output-widget editor keeps the operator's picked widget type sticky
 * across a validation bounce (e.g. selecting ai-template but saving before a
 * template exists). Without `typeOverride` the editor would render the saved
 * type, which read as "it reverted to key-value".
 */
import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { renderOutputWidgetPage } from './agent-output-widget.js';

const keyValueAgent = (): Agent => ({
  id: 'system-tldr-gif', name: 'TLDR gif', status: 'active', source: 'examples', mcp: false,
  nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
  outputWidget: { type: 'key-value', fields: [{ name: 'result', type: 'text' }] },
} as unknown as Agent);

/** Is the card for `type` marked active in the rendered editor HTML? */
function cardActive(html: string, type: string): boolean {
  return new RegExp(`class="ow-card is-active" data-widget-type="${type}"`).test(html);
}

describe('output-widget editor — sticky type selection', () => {
  it('without an override, renders the saved type (key-value) as active', () => {
    const html = renderOutputWidgetPage({ agent: keyValueAgent() });
    expect(cardActive(html, 'key-value')).toBe(true);
    expect(cardActive(html, 'ai-template')).toBe(false);
    expect(html).toMatch(/id="ow-widget-type"[^>]*value="key-value"/);
  });

  it('with typeOverride=ai-template, keeps ai-template selected + shows the template block', () => {
    const html = renderOutputWidgetPage({ agent: keyValueAgent(), typeOverride: 'ai-template' });
    expect(cardActive(html, 'ai-template')).toBe(true);
    expect(cardActive(html, 'key-value')).toBe(false);
    expect(html).toMatch(/id="ow-widget-type"[^>]*value="ai-template"/);
    // The ai-template panel is shown (fields panel is the alternative).
    expect(html).toMatch(/id="ow-ai-block" style="display: block/);
  });
});

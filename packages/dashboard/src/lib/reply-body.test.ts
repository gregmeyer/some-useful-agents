import { describe, expect, it } from 'vitest';
import { render } from '../views/html.js';
import { markAnswered, renderReplyBody } from './reply-body.js';

const widget = JSON.stringify({
  components: [
    { id: 'root', component: 'Row', children: ['b1', 'b2'] },
    { id: 'b1', component: 'Button', child: 'l1', action: { event: { name: 'pick', context: { message: 'This weekend' } } } },
    { id: 'l1', component: 'Text', text: 'This weekend' },
    { id: 'b2', component: 'Button', child: 'l2', action: { event: { name: 'pick', context: { message: 'Next weekend' } } } },
    { id: 'l2', component: 'Text', text: 'Next weekend' },
  ],
  data: {},
});
const reply = `Which weekend?\n\n<a2ui>${widget}</a2ui>`;

describe('renderReplyBody', () => {
  it('draws a reply widget with live buttons until it is answered', () => {
    const out = render(renderReplyBody(reply, 'r1'));
    expect(out).toContain('data-a2ui-surface');
    expect(out).not.toContain('is-answered');
  });

  it('marks an answered widget quieter, with the pick ticked', () => {
    const out = render(renderReplyBody(reply, 'r1', [], { answered: 'Next weekend' }));
    expect(out).toContain('reply-widget is-answered');
    expect(out).toContain('✓ Next weekend');
    expect(out).not.toContain('✓ This weekend');
  });

  it('a reply answered in other words: quieter, nothing ticked', () => {
    const out = render(renderReplyBody(reply, 'r1', [], { answered: 'neither, the one after' }));
    expect(out).toContain('is-answered');
    expect(out).not.toContain('✓');
  });

  it('a widget without buttons is never marked answered', () => {
    const table = JSON.stringify({ components: [{ id: 'root', component: 'Text', text: 'Just facts' }], data: {} });
    expect(render(renderReplyBody(`<a2ui>${table}</a2ui>`, 'r2', [], { answered: 'ok' }))).not.toContain('is-answered');
  });

  it('markAnswered leaves components alone when no button matches', () => {
    const comps = (JSON.parse(widget) as { components: Array<{ id: string; component: string }> }).components;
    expect(markAnswered(comps as never, 'something else')).toBe(comps);
  });
});

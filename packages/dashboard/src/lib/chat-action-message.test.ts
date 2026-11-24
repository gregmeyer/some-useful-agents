import { describe, it, expect } from 'vitest';
import { actionToMessage, tidyListsInText } from './chat-turn.js';
import { replyWidgetComponents } from '@some-useful-agents/core';

describe("a widget's action as the person's next message (A2UI 1.0 forms)", () => {
  it("says a form's userMessage first, with a choice said as words; else the button's message; else its values", () => {
    expect(actionToMessage({ name: 'answer', userMessage: 'Budget 400, ["rental"]', context: { message: 'ignored' } })).toEqual({ message: 'Budget 400, rental' });
    expect(actionToMessage({ name: 'pick', context: { message: 'The first weekend' } })).toEqual({ message: 'The first weekend' });
    expect(actionToMessage({ name: 'answer', context: { budget: '400', kind: ['hotel', 'rental'], none: [] } })).toEqual({ message: '▸ answer (budget: 400, kind: hotel, rental)' });
    expect(tidyListsInText('sizes ["s", "l"], none [], numbers [1,2]')).toBe('sizes s, l, none , numbers [1,2]');
  });

  it('teaches a form: inputs under /data/form, one Button with checks and a userMessage', () => {
    const g = replyWidgetComponents();
    expect(g).toContain('- A form, when the answer is typed or picked');
    expect(g).toContain('"checks":[{"condition":{"call":"required"');
    expect(g).toContain('"userMessage":{"call":"formatString","args":{"value":"Budget ${/data/form/budget}');
  });
});

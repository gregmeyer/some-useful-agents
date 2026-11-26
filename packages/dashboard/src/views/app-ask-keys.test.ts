import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APP_ASK_JS } from './app-ask.js.js';

// Cmd/Ctrl-I opens or closes the inbox drawer, like Cmd/Ctrl-K; not in a rich-text editor (italic there).
describe('Cmd-I opens the inbox drawer', () => {
  type Listener = (e: Record<string, unknown>) => void;
  let keydown: Listener | undefined;
  let active: Record<string, unknown> | null;
  const toggle = vi.fn();
  beforeEach(() => {
    keydown = undefined; active = null; toggle.mockReset();
    const doc = {
      addEventListener: (t: string, f: Listener) => { if (t === 'keydown') keydown = f; },
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
      get activeElement() { return active; }, body: { classList: { contains: () => false } }, readyState: 'complete',
    };
    const win = { suaPanel: { toggle }, addEventListener: () => {}, location: { pathname: '/' } };
    new Function('document', 'window', APP_ASK_JS)(doc, win);
  });
  const press = (over: Record<string, unknown>) => { const e = { key: 'i', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...over }; keydown!(e); return e; };

  it('toggles the drawer on Cmd-I and Ctrl-I', () => {
    expect(keydown).toBeTypeOf('function');
    press({});
    press({ metaKey: false, ctrlKey: true, key: 'I' });
    expect(toggle).toHaveBeenCalledTimes(2);
  });
  it('leaves Cmd-I alone in a rich-text editor, and Cmd-Shift-I / Cmd-Alt-I to the browser', () => {
    active = { isContentEditable: true };
    const e = press({});
    expect(e.preventDefault).not.toHaveBeenCalled();
    active = null;
    press({ shiftKey: true }); press({ altKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });
});

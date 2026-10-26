import { describe, it, expect } from 'vitest';
import { working, WORKING_JS } from './working.js';
import { render } from './html.js';
import { renderNotebookNew } from './notebook-new.js';

/** The browser's window.suaWorking, from the bundled script. */
function browserWorking(): (o: Record<string, string>) => string {
  const win: Record<string, unknown> = {};
  const doc = { querySelectorAll: () => [] };
  new Function('window', 'document', 'setInterval', WORKING_JS)(win, doc, () => 0);
  return win.suaWorking as (o: Record<string, string>) => string;
}
const squash = (s: string) => s.replace(/>\s+</g, '><').trim();

describe('the working component', () => {
  it('draws the same from the server and from a script, inline and as a panel', () => {
    const suaWorking = browserWorking();
    const inline = { text: 'Drafting…' };
    expect(squash(render(working(inline)))).toBe(suaWorking(inline));
    const panel = { size: 'panel', title: 'sua heard you and is drafting your notebook', said: 'What do teams pay for a <CRM>?', text: 'Usually about a minute.', since: '2026-10-26T12:00:00.000Z' } as const;
    expect(squash(render(working(panel)))).toBe(squash(suaWorking(panel)));
    // What you asked is shown as you said it, never as markup.
    expect(suaWorking(panel)).toContain('“What do teams pay for a &lt;CRM&gt;?”');
    expect(suaWorking(panel)).toContain('data-working-since="2026-10-26T12:00:00.000Z"');
  });
});

describe('starting a notebook', () => {
  it('says sua heard you, right under the box: what you asked, what it is doing, how long', () => {
    const page = renderNotebookNew({ draft: { id: 'd1', state: { status: 'working', text: 'What do teams pay for a CRM?', at: Date.parse('2026-10-26T12:00:00Z') }, agents: [] }, templates: [{ id: 't1', name: 'Job search', description: '', uses: 0 }] });
    expect(page).toContain('class="working working--panel"');
    expect(page).toContain('“What do teams pay for a CRM?”');
    expect(page).toContain('data-working-since="2026-10-26T12:00:00.000Z"');
    // Above your templates, not under them.
    expect(page.indexOf('data-nbd-result')).toBeLessThan(page.indexOf('Job search'));
  });

  it('a ready draft says so at its top, with Start there and in the bar that stays in view', () => {
    const draft = { title: 'CRM prices', statement: 'Find out what a 10-person team pays', params: [], criteria: [], fields: [], checks: [], stages: [], steps: [], pipeline: [] };
    const page = renderNotebookNew({ draft: { id: 'd1', state: { status: 'ready', text: 'x', at: 0, draft: draft as never }, agents: [] } });
    expect(page).toMatch(/data-nbd-ready>[\s\S]*?Your notebook draft is ready\.[\s\S]*?Looks right, start it<\/button>/);
    expect(page.match(/Looks right, start it/g)).toHaveLength(2);
  });
});

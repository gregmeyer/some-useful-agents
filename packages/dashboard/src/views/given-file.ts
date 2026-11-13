/**
 * "Choose a file" beside a box you'd otherwise paste into (what a notebook
 * needs from you): a PDF's text is read on the server (POST
 * /notebooks/given-file), a plain text file in the browser, and either
 * lands in the box for you to look at before you press its button. Nothing
 * is kept until you do. Without scripts the box still takes a paste.
 */
import { html, type SafeHtml } from './html.js';

/** The control: `boxId` is the textarea it fills. */
export function givenFilePick(boxId: string): SafeHtml {
  return html`<div class="given-file">
            <label class="btn btn--sm given-file__pick">Choose a PDF or text file<input type="file" class="sr-only" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" data-given-file="${boxId}"></label>
            <span class="given-file__say" data-given-file-say aria-live="polite">A profile or résumé saved as PDF works. Its text lands in the box above.</span>
          </div>`;
}

export const GIVEN_FILE_JS = `
  (function () {
    var MAX = 15 * 1024 * 1024;
    document.addEventListener('change', function (e) {
      var inp = e.target;
      if (!inp || !inp.getAttribute || !inp.getAttribute('data-given-file')) return;
      var f = inp.files && inp.files[0];
      var box = document.getElementById(inp.getAttribute('data-given-file'));
      var wrap = inp.closest('.given-file');
      var say = wrap && wrap.querySelector('[data-given-file-say]');
      if (!f || !box || !say) return;
      function tell(t, bad) { say.textContent = t; say.classList.toggle('given-file__say--bad', !!bad); }
      function done() { inp.value = ''; }
      function fill(text, msg) {
        box.value = text;
        // A page that keeps drafts as you type hears this as typing.
        box.dispatchEvent(new Event('input', { bubbles: true }));
        tell(msg);
        box.focus();
        box.scrollTop = 0;
        done();
      }
      var name = String(f.name || '');
      var dot = name.lastIndexOf('.');
      var ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
      var isPdf = f.type === 'application/pdf' || ext === 'pdf';
      var isText = (f.type || '').indexOf('text/') === 0 || ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'text';
      if (!isPdf && !isText) { tell('sua reads PDF and plain text files here. Save a Word file as PDF first, or paste its text.', true); done(); return; }
      if (f.size > MAX) { tell('That file is larger than 15 MB. Paste its text here.', true); done(); return; }
      if (isText) {
        f.text().then(function (t) {
          if (!t.trim()) { tell('That file is empty.', true); done(); return; }
          fill(t, 'Read ' + name + ' (' + t.trim().length.toLocaleString('en-US') + ' characters). Look it over, then press the button under the box. sua reads it into a short form before any search.');
        }).catch(function () { tell('That file couldn\\'t be read. Paste its text here.', true); done(); });
        return;
      }
      tell('Reading ' + name + '…');
      fetch('/notebooks/given-file', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/pdf', 'X-Requested-With': 'fetch' }, body: f })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j || !res.j.text) { tell((res.j && res.j.error) || 'sua couldn\\'t read that PDF. Paste its text here.', true); done(); return; }
          fill(res.j.text, 'Read ' + name + ': ' + res.j.said + ' Look it over, then press the button under the box. sua reads it into a short form before any search.');
        })
        .catch(function () { tell('sua couldn\\'t read that PDF. Paste its text here.', true); done(); });
    });
  })();
`;

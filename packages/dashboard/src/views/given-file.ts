/**
 * "Choose a file" beside a box you'd otherwise paste into (what a notebook
 * needs from you): a PDF's text is read on the server (POST
 * /notebooks/given-file), a plain text file in the browser, and either
 * lands in the box for you to look at before you press its button. Nothing
 * is kept until you do. Without scripts the box still takes a paste.
 */
import { html, type SafeHtml } from './html.js';

/** The control: `boxId` is the textarea it fills; `nameId`, a "what is it?" field it fills from the file's name when that's empty. */
export function givenFilePick(boxId: string, nameId?: string): SafeHtml {
  return html`<div class="given-file">
            <label class="btn btn--sm given-file__pick">Choose a PDF or text file<input type="file" class="sr-only" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" data-given-file="${boxId}"${nameId ? html` data-given-file-name="${nameId}"` : html``}></label>
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
        // What it is, from the file's name ("Dana-Reyes-Profile.pdf" → "Dana Reyes Profile"), unless you already said.
        var nameBox = inp.getAttribute('data-given-file-name') && document.getElementById(inp.getAttribute('data-given-file-name'));
        if (nameBox && !nameBox.value.trim()) nameBox.value = (dot > 0 ? name.slice(0, dot) : name).replace(/[_-]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 80);
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

/**
 * Attach a file to a message in a conversation (a form marked `data-attach`):
 * the paperclip beside Send, or a file dropped on the message box. Its text
 * is read the same way (a PDF on the server, a text file in the browser),
 * kept with POST /notebooks/attach, and a marker for it goes on a line of
 * the message; sending the message files it (lib/conversation-attach.ts).
 */
export function attachPick(): SafeHtml {
  return html`<label class="attach-pick" title="Attach a PDF or text file"><span class="sr-only">Attach a PDF or text file</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3"/></svg><input type="file" class="sr-only" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" data-attach-file></label>`;
}

export const ATTACH_JS = `
  (function () {
    var MAX = 15 * 1024 * 1024;
    function say(form, t, bad) {
      var p = form.parentNode && form.parentNode.querySelector('[data-attach-say]');
      if (!p) {
        p = document.createElement('p');
        p.setAttribute('data-attach-say', '');
        p.setAttribute('aria-live', 'polite');
        p.className = 'attach-say';
        form.insertAdjacentElement('afterend', p);
      }
      p.textContent = t;
      p.classList.toggle('attach-say--bad', !!bad);
    }
    function json(r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }
    function keep(form, label, text) {
      fetch('/notebooks/attach', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ label: label, text: text.slice(0, 40000) }) })
        .then(json)
        .then(function (res) {
          if (!res.ok || !res.j || !res.j.marker) { say(form, (res.j && res.j.error) || 'That file couldn\\'t be kept. Paste its text in your message.', true); return; }
          var ta = form.querySelector('textarea');
          if (!ta) return;
          var was = ta.value.replace(/\\s+$/, '');
          ta.value = (was ? was + '\\n' : '') + res.j.marker;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.focus();
          say(form, 'Attached ' + res.j.label + ' (' + Number(res.j.chars).toLocaleString('en-US') + ' characters' + (text.length > 40000 ? ', the first 40,000 kept' : '') + '). It goes with your message: say what to do with it, then send. The file itself isn\\'t kept.');
        })
        .catch(function () { say(form, 'That file couldn\\'t be kept. Paste its text in your message.', true); });
    }
    function take(form, f) {
      var name = String(f.name || 'file');
      var dot = name.lastIndexOf('.');
      var ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
      var label = (dot > 0 ? name.slice(0, dot) : name).replace(/[_\\-\\[\\]]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 80) || 'file';
      var isPdf = f.type === 'application/pdf' || ext === 'pdf';
      var isText = (f.type || '').indexOf('text/') === 0 || ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'text';
      if (!isPdf && !isText) { say(form, 'sua reads PDF and plain text files. Save a Word file as PDF first, or paste its text.', true); return; }
      if (f.size > MAX) { say(form, 'That file is larger than 15 MB. Paste the part that matters.', true); return; }
      say(form, 'Reading ' + name + '…');
      if (isText) {
        f.text().then(function (t) {
          if (t.trim().length < 20) { say(form, 'There\\'s too little text in that file to keep.', true); return; }
          keep(form, label, t);
        }).catch(function () { say(form, 'That file couldn\\'t be read. Paste its text in your message.', true); });
        return;
      }
      fetch('/notebooks/given-file', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/pdf', 'X-Requested-With': 'fetch' }, body: f })
        .then(json)
        .then(function (res) {
          if (!res.ok || !res.j || !res.j.text) { say(form, (res.j && res.j.error) || 'sua couldn\\'t read that PDF. Paste its text in your message.', true); return; }
          keep(form, label, res.j.text);
        })
        .catch(function () { say(form, 'sua couldn\\'t read that PDF. Paste its text in your message.', true); });
    }
    document.addEventListener('change', function (e) {
      var inp = e.target;
      if (!inp || !inp.hasAttribute || !inp.hasAttribute('data-attach-file')) return;
      var form = inp.closest('form');
      var f = inp.files && inp.files[0];
      if (form && f) take(form, f);
      inp.value = '';
    });
    function dropForm(e) {
      var ta = e.target && e.target.closest && e.target.closest('textarea');
      var form = ta && ta.closest('form[data-attach]');
      var has = e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0;
      return form && has ? form : null;
    }
    document.addEventListener('dragover', function (e) { if (dropForm(e)) e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      var form = dropForm(e);
      if (!form) return;
      e.preventDefault();
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) take(form, f);
    });
  })();
`;

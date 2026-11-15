/**
 * "Choose a file" beside a box you'd otherwise paste into (what a notebook
 * needs from you): a PDF's text is read on the server (POST
 * /notebooks/given-file), a plain text file in the browser, and either
 * lands in the box for you to look at before you press its button. Nothing
 * is kept until you do. Without scripts the box still takes a paste.
 */
import { html, type SafeHtml } from './html.js';
import { currentFileTypes } from '../lib/file-types.js';

/** The control: `boxId` is the textarea it fills; `nameId`, a "what is it?" field it fills from the file's name when that's empty. */
export function givenFilePick(boxId: string, nameId?: string): SafeHtml {
  const t = currentFileTypes();
  // No kind of file is allowed (Settings → General): the box still takes a paste.
  if (!t.exts.length) return html``;
  return html`<div class="given-file">
            <label class="btn btn--sm given-file__pick">Choose a file<input type="file" class="sr-only" accept="${t.accept}" data-file-types="${t.exts.join(',')}" data-file-words="${t.words}" data-given-file="${boxId}"${nameId ? html` data-given-file-name="${nameId}"` : html``}></label>
            <span class="given-file__say" data-given-file-say aria-live="polite">${t.words} files. A profile or résumé saved as PDF works well. Its text lands in the box above.</span>
          </div>`;
}

/**
 * Reading a chosen file into text, for both pickers: the kinds allowed are
 * on the input (`data-file-types`); a PDF or Word file is read on the
 * server, plain text in the browser. `done` gets {text, name, label, said}
 * or {error}.
 */
export const FILE_READ_JS = `
  window.suaReadFile = function (inp, f, done) {
    var MAX = 15 * 1024 * 1024;
    var MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    var allowed = String((inp && inp.getAttribute && inp.getAttribute('data-file-types')) || 'pdf,txt,md,docx').split(',');
    var words = (inp && inp.getAttribute && inp.getAttribute('data-file-words')) || 'PDF or text';
    var name = String(f.name || 'file');
    var dot = name.lastIndexOf('.');
    var ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (ext === 'markdown') ext = 'md';
    if (ext === 'text') ext = 'txt';
    if (!ext && f.type === 'application/pdf') ext = 'pdf';
    if (!ext && (f.type || '').indexOf('text/') === 0) ext = 'txt';
    var label = (dot > 0 ? name.slice(0, dot) : name).replace(/[_\\-\\[\\]]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 80) || 'file';
    if (allowed.indexOf(ext) < 0) { done({ error: 'sua takes ' + words + ' files here' + (ext === 'doc' ? ' (save an older .doc as .docx or PDF first)' : '') + '. Or paste the text.' }); return; }
    if (f.size > MAX) { done({ error: 'That file is larger than 15 MB. Paste the part that matters.' }); return; }
    if (!MIME[ext]) {
      f.text().then(function (t) {
        if (!t.trim()) { done({ error: 'That file is empty.' }); return; }
        done({ text: t, name: name, label: label, said: t.trim().length.toLocaleString('en-US') + ' characters.' });
      }).catch(function () { done({ error: 'That file couldn\\'t be read. Paste its text.' }); });
      return;
    }
    fetch('/notebooks/given-file', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': MIME[ext], 'X-Requested-With': 'fetch' }, body: f })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j || !res.j.text) { done({ error: (res.j && res.j.error) || 'sua couldn\\'t read that file. Paste its text.' }); return; }
        done({ text: res.j.text, name: name, label: label, said: res.j.said });
      })
      .catch(function () { done({ error: 'sua couldn\\'t read that file. Paste its text.' }); });
  };
`;

export const GIVEN_FILE_JS = `
  (function () {
    document.addEventListener('change', function (e) {
      var inp = e.target;
      if (!inp || !inp.getAttribute || !inp.getAttribute('data-given-file')) return;
      var f = inp.files && inp.files[0];
      var box = document.getElementById(inp.getAttribute('data-given-file'));
      var wrap = inp.closest('.given-file');
      var say = wrap && wrap.querySelector('[data-given-file-say]');
      if (!f || !box || !say) return;
      function tell(t, bad) { say.textContent = t; say.classList.toggle('given-file__say--bad', !!bad); }
      tell('Reading ' + String(f.name || 'the file') + '…');
      window.suaReadFile(inp, f, function (out) {
        inp.value = '';
        if (out.error) { tell(out.error, true); return; }
        // What it is, from the file's name ("Dana-Reyes-Profile.pdf" → "Dana Reyes Profile"), unless you already said.
        var nameBox = inp.getAttribute('data-given-file-name') && document.getElementById(inp.getAttribute('data-given-file-name'));
        if (nameBox && !nameBox.value.trim()) nameBox.value = out.label;
        box.value = out.text;
        // A page that keeps drafts as you type hears this as typing.
        box.dispatchEvent(new Event('input', { bubbles: true }));
        tell('Read ' + out.name + ': ' + out.said + ' Look it over, then press the button under the box. sua reads it into a short form before any search.');
        box.focus();
        box.scrollTop = 0;
      });
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
  const t = currentFileTypes();
  if (!t.exts.length) return html``;
  return html`<label class="attach-pick" title="Attach a file (${t.words})"><span class="sr-only">Attach a file (${t.words})</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3"/></svg><input type="file" class="sr-only" accept="${t.accept}" data-file-types="${t.exts.join(',')}" data-file-words="${t.words}" data-attach-file></label>`;
}

export const ATTACH_JS = `
  (function () {
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
    function keep(form, label, text) {
      fetch('/notebooks/attach', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ label: label, text: text.slice(0, 40000) }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
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
      var inp = form.querySelector('[data-attach-file]');
      if (!inp) return;
      say(form, 'Reading ' + String(f.name || 'the file') + '…');
      window.suaReadFile(inp, f, function (out) {
        if (out.error) { say(form, out.error, true); return; }
        if (out.text.trim().length < 20) { say(form, 'There\\'s too little text in that file to keep.', true); return; }
        keep(form, out.label, out.text);
      });
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
      return form && has && form.querySelector('[data-attach-file]') ? form : null;
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

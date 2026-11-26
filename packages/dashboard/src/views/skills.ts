/**
 * `/skills`: know-how several agents share (docs/skills.md, ADR-0054), to
 * read, write and change. A skill's text is the operator's own or shipped
 * with sua; it still renders only through renderMarkdownSafe, like a
 * behavior's, and every other part as escaped text.
 */
import { renderMarkdownSafe, type SkillVersion } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { sectionTabs } from './section-tabs.js';
import { kb, MAX_SKILL_BYTES, MAX_SKILLS_PREAMBLE_BYTES, skillMarkdown, type SkillFormValues, type SkillOrigin, type SkillRow } from '../lib/skill-edit.js';

type Flash = { kind: 'error' | 'info' | 'ok'; message: string };

const ORIGIN_WORD: Record<SkillOrigin, string> = { shipped: 'SHIPPED', yours: 'YOURS', 'your-copy': 'YOUR COPY' };
const ORIGIN_HINT: Record<SkillOrigin, string> = {
  shipped: 'Shipped with sua. Changing it saves your own copy, which agents use instead.',
  yours: 'Written here. Every save is kept as a version.',
  'your-copy': "Your copy of a skill sua ships. Agents use it instead of sua's.",
};

/** Lines wrapped by hand in the file read as one paragraph (lists, headings, quotes, tables and code keep their lines). */
export function unwrap(md: string): string {
  let fenced = false;
  return md.split('\n').reduce<string[]>((out, line) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; out.push(line); return out; }
    const prev = out[out.length - 1];
    const joins = !fenced && prev !== undefined && prev.trim() !== '' && line.trim() !== '' && !/^\s*([-*+>#|]|\d+[.)]\s)/.test(line) && !/^\s*(#|\||```)/.test(prev);
    if (joins) out[out.length - 1] = `${prev} ${line.trim()}`; else out.push(line);
    return out;
  }, []).join('\n');
}

const size = (bytes: number) => html`<span class="skill-size${bytes > MAX_SKILL_BYTES ? ' is-over' : ''}">${kb(bytes)} of ${kb(MAX_SKILL_BYTES).replace('.0', '')}</span>`;
const usedWords = (n: number) => (n === 0 ? 'used by no agent' : `used by ${String(n)} agent${n === 1 ? '' : 's'}`);

export function renderSkillsList(args: { rows: SkillRow[]; problems: Array<{ file: string; message: string }>; flash?: Flash }): string {
  const body = html`
    ${pageHeader({
      title: 'Skills',
      description: 'Know-how several agents share: how a kind of work is done, written once and quoted into each run that lists it. Write one, paste a SKILL.md, or change one sua ships with.',
      cta: html`<a class="btn btn--sm btn--primary" href="/skills/new">New skill</a>`,
    })}
    ${sectionTabs('skills')}
    ${args.rows.length === 0 ? html`<p class="dim">No skills yet. <a href="/skills/new">Write the first one →</a></p>` : html`
      <ul class="skill-rows">
        ${args.rows.map((r) => html`
          <li class="skill-row">
            <p class="skill-row__eyebrow"><span title="${ORIGIN_HINT[r.origin]}">${ORIGIN_WORD[r.origin]}${r.skill.version ? ` · v${String(r.skill.version)}` : ''}</span> ${size(r.bytes)}</p>
            <a class="skill-row__name" href="/skills/${encodeURIComponent(r.skill.name)}">${r.skill.name}</a>
            <p class="skill-row__desc">${r.skill.description}</p>
            <p class="skill-row__meta">${usedWords(r.usedBy.length)}${r.usedBy.length ? html`: ${r.usedBy.slice(0, 4).map((a, i) => html`${i ? ', ' : ''}<a href="/agents/${encodeURIComponent(a.id)}">${a.id}</a>`) as unknown as SafeHtml[]}${r.usedBy.length > 4 ? ` +${String(r.usedBy.length - 4)}` : ''}` : html``}</p>
          </li>
        `) as unknown as SafeHtml[]}
      </ul>
    `}
    ${args.problems.length ? html`
      <details class="skill-problems"><summary>${String(args.problems.length)} skill file${args.problems.length === 1 ? '' : 's'} couldn't be read</summary>
        <ul>${args.problems.map((p) => html`<li><code class="mono">${p.file}</code>: ${p.message}</li>`) as unknown as SafeHtml[]}</ul>
      </details>` : html``}
  `;
  return render(layout({ title: 'Skills · sua', activeNav: 'agents', ...(args.flash ? { flash: args.flash } : {}) }, body));
}

export interface SkillDetailArgs {
  row: SkillRow;
  versions: SkillVersion[];
  /** Agents that don't list it yet, to add it to. */
  others: Array<{ id: string; name: string; bytes: number }>;
  flash?: Flash;
}

export function renderSkillDetail(a: SkillDetailArgs): string {
  const { skill, origin, bytes, usedBy } = a.row;
  const name = encodeURIComponent(skill.name);
  const text = unsafeHtml(`<div class="md-body skill-body">${renderMarkdownSafe(unwrap(skill.body)).replace(/<a /g, '<a target="_blank" rel="noreferrer nofollow" ')}</div>`);
  const body = html`
    ${pageHeader({
      title: skill.name,
      back: { href: '/skills', label: 'Skills' },
      description: skill.description,
      cta: html`<a class="btn btn--sm btn--primary" href="/skills/${name}/edit">Edit</a>`,
    })}
    <p class="skill-meta" title="${ORIGIN_HINT[origin]}">${ORIGIN_WORD[origin]}${skill.version ? ` · v${String(skill.version)}` : ''} · ${size(bytes)} · ${usedWords(usedBy.length)}</p>
    <div class="skill-detail">
      <article class="skill-detail__main">
        ${text}
        <details class="skill-raw"><summary>As a SKILL.md</summary><pre class="mono">${skillMarkdown(skill)}</pre></details>
      </article>
      <aside class="skill-detail__side">
        <section class="skill-side">
          <h2 class="skill-side__label">Used by</h2>
          ${usedBy.length ? html`<ul class="skill-side__list">${usedBy.map((u) => html`
            <li><a href="/agents/${encodeURIComponent(u.id)}">${u.id}</a>
              <form method="post" action="/skills/${name}/agents/${encodeURIComponent(u.id)}/remove"><button class="btn btn--sm btn--ghost" type="submit" title="Take ${skill.name} off ${u.id} (a new version of the agent)">Remove</button></form></li>`) as unknown as SafeHtml[]}</ul>`
            : html`<p class="dim">No agent lists it yet.</p>`}
          ${a.others.length ? html`
            <form class="skill-side__add" method="post" action="/skills/${name}/agents">
              <label class="dim" for="skill-add-agent">Add to an agent</label>
              <select id="skill-add-agent" name="agentId" class="form-field">${a.others.map((o) => html`<option value="${o.id}">${o.id}${o.bytes ? ` (${kb(o.bytes)} of skills)` : ''}</option>`) as unknown as SafeHtml[]}</select>
              <button class="btn btn--sm" type="submit">Add</button>
            </form>
            <p class="dim skill-side__hint">An agent's skills can add up to ${String(MAX_SKILLS_PREAMBLE_BYTES / 1024)} KB. Adding one saves a new version of the agent.</p>` : html``}
        </section>
        ${a.versions.length ? html`
          <section class="skill-side">
            <h2 class="skill-side__label">Versions</h2>
            <ol class="skill-side__list">${a.versions.map((v) => html`
              <li><span class="mono">v${String(v.version)}</span> <span class="dim">${v.createdAt.slice(0, 10)}${v.message ? ` · ${v.message}` : ''}</span>
                ${v.version === skill.version ? html`<span class="dim">current</span>` : html`<form method="post" action="/skills/${name}/restore"><input type="hidden" name="version" value="${String(v.version)}"><button class="btn btn--sm btn--ghost" type="submit">Restore</button></form>`}</li>`) as unknown as SafeHtml[]}</ol>
          </section>` : html``}
        ${origin === 'your-copy' ? html`
          <form method="post" action="/skills/${name}/reset" class="skill-side"><button class="btn btn--sm btn--ghost" type="submit">Go back to sua's version</button><p class="dim skill-side__hint">Your copy and its versions are dropped; agents use the shipped one again.</p></form>` : html``}
        ${origin === 'yours' ? html`
          <form method="post" action="/skills/${name}/delete" class="skill-side"><button class="btn btn--sm btn--ghost" type="submit" ${usedBy.length ? 'disabled' : ''}>Delete skill</button>${usedBy.length ? html`<p class="dim skill-side__hint">Take it off the agents that use it first; they'd stop running without it.</p>` : html``}</form>` : html``}
      </aside>
    </div>
  `;
  return render(layout({ title: `${skill.name} · Skills · sua`, activeNav: 'agents', wide: true, ...(a.flash ? { flash: a.flash } : {}) }, body));
}

export function renderSkillForm(args: { mode: 'new' | 'edit'; values: SkillFormValues; origin?: SkillOrigin; error?: string }): string {
  const v = args.values;
  const editing = args.mode === 'edit';
  const action = editing ? `/skills/${encodeURIComponent(v.name)}/edit` : '/skills/new';
  const body = html`
    ${pageHeader({
      title: editing ? `Edit ${v.name}` : 'New skill',
      back: editing ? { href: `/skills/${encodeURIComponent(v.name)}`, label: v.name } : { href: '/skills', label: 'Skills' },
      description: editing
        ? (args.origin === 'shipped' ? "sua ships this skill. Saving keeps your own copy, and agents use it instead; you can go back to sua's any time." : 'Saving keeps the last text as a version you can restore.')
        : 'How a kind of work is done, in a few short rules. Paste a whole SKILL.md and its name and description fill in.',
    })}
    <form class="skill-form" method="post" action="${action}">
      ${args.error ? html`<p class="skill-form__error" role="alert">${args.error}</p>` : html``}
      <label class="skill-form__label" for="skill-name">Name</label>
      <input id="skill-name" class="form-field mono" name="name" value="${v.name}" ${editing ? 'readonly' : ''} maxlength="64" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="evaluate-software" autocomplete="off">
      <p class="skill-form__hint">Lowercase words with hyphens. Agents list it by this name.</p>
      <label class="skill-form__label" for="skill-desc">What it's for</label>
      <input id="skill-desc" class="form-field" name="description" value="${v.description}" maxlength="300" placeholder="When to use it, in one line">
      <label class="skill-form__label" for="skill-body">The know-how</label>
      <textarea id="skill-body" class="form-field skill-form__body mono" name="body" rows="22" spellcheck="false" data-skill-body placeholder="Markdown. Rules, not a manual: what to do, in what order, what never to do.">${v.body}</textarea>
      <p class="skill-form__hint"><span data-skill-bytes>${kb(Buffer.byteLength(v.body, 'utf8'))}</span> of ${String(MAX_SKILL_BYTES / 1024)} KB. Quoted as written: no {{…}} templates.</p>
      ${editing ? html`<label class="skill-form__label" for="skill-msg">What changed <span class="dim">(optional)</span></label>
      <input id="skill-msg" class="form-field" name="message" maxlength="120">` : html``}
      <div class="skill-form__actions">
        <button class="btn btn--primary" type="submit">${editing ? 'Save' : 'Save skill'}</button>
        <a class="btn btn--ghost" href="${editing ? `/skills/${encodeURIComponent(v.name)}` : '/skills'}">Cancel</a>
      </div>
    </form>
    ${unsafeHtml(SKILL_FORM_JS)}
  `;
  return render(layout({ title: `${editing ? 'Edit skill' : 'New skill'} · sua`, activeNav: 'agents' }, body));
}

// The size as you type (over the limit, it turns warn), and a pasted SKILL.md filling the name and description.
const SKILL_FORM_JS = `<script>
(function () {
  var box = document.querySelector('[data-skill-body]');
  var out = document.querySelector('[data-skill-bytes]');
  if (!box || !out) return;
  var max = ${String(MAX_SKILL_BYTES)};
  function size() {
    var n = new Blob([box.value.trim()]).size;
    out.textContent = (n / 1024).toFixed(1) + ' KB';
    out.parentNode.classList.toggle('is-over', n > max);
  }
  box.addEventListener('input', size);
  box.addEventListener('paste', function () {
    setTimeout(function () {
      var m = /^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)$/.exec(box.value.trim());
      if (!m) return;
      var name = document.getElementById('skill-name');
      var desc = document.getElementById('skill-desc');
      m[1].split(/\\r?\\n/).forEach(function (line) {
        var f = /^(name|description)\\s*:\\s*(.+)$/.exec(line);
        if (!f) return;
        var val = f[2].trim().replace(/^(["'])([\\s\\S]*)\\1$/, '$2');
        if (f[1] === 'name' && name && !name.value && !name.readOnly) name.value = val;
        if (f[1] === 'description' && desc && !desc.value) desc.value = val;
      });
      box.value = m[2].trim();
      size();
    }, 0);
  });
  size();
})();
</script>`;

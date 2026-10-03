// Pickers for toolbars (docs/boards.md § Arranging a canvas). A plain ES module.
//
//   menuButton({ label, groups, onPick })
//     A button that opens a short grouped menu. groups: [{ title?, items: [{ value, label, hint? }] }].
//
//   searchPicker({ label, placeholder, items, filters, pageSize, onPick })
//     A button that opens a popover with a search box, filter chips and a
//     paged list. items: [{ value, label, sub?, detail?, tags? }]; each filter
//     is { id, label, test(item) }, the first is the default. Search matches
//     label, sub and detail; "Show more" adds a page.
//
// Both: ↑/↓ move, Enter picks, Esc or a click outside closes, focus returns
// to the button. Each returns { el, close } — append `el` where it goes.

let openPopover = null;

function closeOpen() {
  if (openPopover) openPopover();
}

document.addEventListener('pointerdown', (e) => {
  if (!openPopover) return;
  const pop = document.querySelector('.picker__pop:not([hidden])');
  const owner = pop && pop.parentElement;
  if (owner && !owner.contains(e.target)) closeOpen();
});

let seq = 0;

function shell(label) {
  const id = `picker-${++seq}`;
  const el = document.createElement('div');
  el.className = 'picker';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--sm btn--ghost picker__button';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', id);
  btn.innerHTML = '<span class="picker__label"></span><span class="picker__caret" aria-hidden="true">▾</span>';
  btn.querySelector('.picker__label').textContent = label;
  const pop = document.createElement('div');
  pop.className = 'picker__pop';
  pop.id = id;
  pop.hidden = true;
  el.append(btn, pop);
  return { el, btn, pop, id };
}

/** Keyboard + open/close shared by both pickers. `rows()` lists the pickable option elements. */
function wire({ btn, pop, rows, onOpen, focusOnOpen, pick }) {
  let active = -1;
  const setActive = (i) => {
    const list = rows();
    if (list.length === 0) { active = -1; return; }
    active = Math.max(0, Math.min(i, list.length - 1));
    list.forEach((r, j) => r.classList.toggle('is-active', j === active));
    const row = list[active];
    row.scrollIntoView({ block: 'nearest' });
    const owner = pop.querySelector('[role="listbox"]');
    if (owner) owner.setAttribute('aria-activedescendant', row.id);
  };
  const close = (refocus = true) => {
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (openPopover === closeHere) openPopover = null;
    if (refocus) btn.focus();
  };
  const closeHere = () => close(false);
  const open = () => {
    closeOpen();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openPopover = closeHere;
    onOpen();
    active = -1;
    setActive(0);
    (focusOnOpen() || pop).focus();
  };
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && pop.hidden) { e.preventDefault(); open(); }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Home' && e.target.tagName !== 'INPUT') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && e.target.tagName !== 'INPUT') { e.preventDefault(); setActive(rows().length - 1); }
    else if (e.key === 'Enter') {
      const row = rows()[active];
      if (row && !row.hasAttribute('aria-disabled')) { e.preventDefault(); row.click(); }
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close(false);
  });
  pop.addEventListener('click', (e) => {
    const row = e.target.closest('[role="option"]');
    if (!row || row.hasAttribute('aria-disabled')) return;
    close();
    pick(row.dataset.value);
  });
  pop.addEventListener('mousemove', (e) => {
    const row = e.target.closest('[role="option"]');
    if (row) setActive(rows().indexOf(row));
  });
  return { open, close, setActive, getActive: () => active };
}

function option(id, item) {
  const li = document.createElement('li');
  li.id = id;
  li.className = 'picker__option';
  li.setAttribute('role', 'option');
  li.dataset.value = item.value;
  const main = document.createElement('span');
  main.className = 'picker__option-main';
  const name = document.createElement('span');
  name.className = 'picker__option-label';
  name.textContent = item.label;
  main.append(name);
  if (item.sub) {
    const sub = document.createElement('span');
    sub.className = 'picker__option-sub';
    sub.textContent = item.sub;
    main.append(sub);
  }
  li.append(main);
  if (item.detail) {
    const d = document.createElement('span');
    d.className = 'picker__option-detail';
    d.textContent = item.detail;
    li.append(d);
  }
  for (const tag of item.tags || []) {
    const t = document.createElement('span');
    t.className = 'picker__tag';
    t.textContent = tag;
    main.append(t);
  }
  if (item.hint) {
    const h = document.createElement('span');
    h.className = 'picker__option-detail';
    h.textContent = item.hint;
    li.append(h);
  }
  return li;
}

export function menuButton({ label, groups, onPick }) {
  const { el, btn, pop, id } = shell(label);
  btn.setAttribute('aria-haspopup', 'menu');
  pop.classList.add('picker__pop--menu');
  pop.tabIndex = -1;
  const list = document.createElement('ul');
  list.className = 'picker__list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  let n = 0;
  for (const g of groups) {
    if (g.items.length === 0) continue;
    if (g.title) {
      const h = document.createElement('li');
      h.className = 'picker__group';
      h.setAttribute('role', 'presentation');
      h.textContent = g.title;
      list.append(h);
    }
    for (const item of g.items) list.append(option(`${id}-o${n++}`, item));
  }
  pop.append(list);
  const rows = () => [...list.querySelectorAll('[role="option"]')];
  const w = wire({ btn, pop, rows, onOpen: () => {}, focusOnOpen: () => pop, pick: onPick });
  return { el, close: () => w.close(false) };
}

export function searchPicker({ label, placeholder, items, filters = [], pageSize = 20, onPick, empty = 'Nothing matches.' }) {
  const { el, btn, pop, id } = shell(label);
  pop.classList.add('picker__pop--search');
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'picker__search';
  search.placeholder = placeholder || 'Search…';
  search.setAttribute('aria-label', placeholder || 'Search');
  search.setAttribute('aria-controls', `${id}-list`);
  search.autocomplete = 'off';
  const chips = document.createElement('div');
  chips.className = 'picker__chips';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Show');
  const list = document.createElement('ul');
  list.className = 'picker__list';
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  const foot = document.createElement('div');
  foot.className = 'picker__foot';
  const count = document.createElement('span');
  count.className = 'picker__count';
  count.setAttribute('aria-live', 'polite');
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'btn btn--xs btn--ghost picker__more';
  foot.append(count, more);
  pop.append(search, ...(filters.length > 1 ? [chips] : []), list, foot);

  let filter = filters[0]?.id;
  let shown = pageSize;
  const chipEls = filters.map((f) => {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'picker__chip';
    c.dataset.filter = f.id;
    chips.append(c);
    return c;
  });

  const getItems = () => (typeof items === 'function' ? items() : items);
  const matches = () => {
    const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const f = filters.find((x) => x.id === filter);
    return getItems().filter((it) => {
      if (f && !f.test(it)) return false;
      if (q.length === 0) return true;
      const hay = `${it.label} ${it.sub || ''} ${it.detail || ''}`.toLowerCase();
      return q.every((t) => hay.includes(t));
    });
  };
  const render = () => {
    const all = getItems();
    filters.forEach((f, i) => {
      const n = all.filter(f.test).length;
      chipEls[i].textContent = `${f.label} ${n}`;
      chipEls[i].setAttribute('aria-pressed', String(f.id === filter));
    });
    const found = matches();
    list.replaceChildren(...found.slice(0, shown).map((it, i) => option(`${id}-o${i}`, it)));
    if (found.length === 0) {
      const li = document.createElement('li');
      li.className = 'picker__empty';
      li.setAttribute('role', 'presentation');
      li.textContent = empty;
      list.append(li);
    }
    const rest = found.length - Math.min(shown, found.length);
    count.textContent = found.length === 0 ? '' : `${Math.min(shown, found.length)} of ${found.length}`;
    more.hidden = rest <= 0;
    more.textContent = `Show ${Math.min(rest, pageSize)} more`;
  };

  const rows = () => [...list.querySelectorAll('[role="option"]')];
  const w = wire({
    btn, pop, rows,
    onOpen: () => { shown = pageSize; render(); },
    focusOnOpen: () => search,
    pick: onPick,
  });
  search.addEventListener('input', () => { shown = pageSize; render(); w.setActive(0); });
  chips.addEventListener('click', (e) => {
    const c = e.target.closest('[data-filter]');
    if (!c) return;
    filter = c.dataset.filter;
    shown = pageSize;
    render();
    w.setActive(0);
    search.focus();
  });
  more.addEventListener('click', () => {
    const keep = w.getActive();
    shown += pageSize;
    render();
    w.setActive(keep);
    search.focus();
  });
  return { el, close: () => w.close(false) };
}

/**
 * promptPopover({ button, title, placeholder, suggestions, submitLabel, onSubmit })
 * Turns an existing button into one that asks for a short instruction first:
 * a text box, a few example chips that fill it, and a submit button. An empty
 * box is fine (onSubmit gets ''). Enter submits, Shift+Enter is a new line.
 */
export function promptPopover({ button, title, placeholder, suggestions = [], submitLabel = 'Go', hint, onSubmit }) {
  const id = `picker-${++seq}`;
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  button.replaceWith(wrap);
  wrap.append(button);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  const pop = document.createElement('div');
  pop.className = 'picker__pop picker__pop--prompt';
  pop.id = id;
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', title);
  const form = document.createElement('form');
  form.className = 'picker__prompt';
  const h = document.createElement('label');
  h.className = 'picker__prompt-title';
  h.htmlFor = `${id}-text`;
  h.textContent = title;
  const text = document.createElement('textarea');
  text.id = `${id}-text`;
  text.className = 'picker__prompt-text';
  text.rows = 3;
  text.maxLength = 500;
  text.placeholder = placeholder || '';
  const chips = document.createElement('div');
  chips.className = 'picker__chips';
  for (const s of suggestions) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'picker__chip';
    c.textContent = s;
    c.addEventListener('click', () => { text.value = s; text.focus(); });
    chips.append(c);
  }
  const foot = document.createElement('div');
  foot.className = 'picker__foot';
  const note = document.createElement('span');
  note.className = 'picker__count';
  note.textContent = hint || '';
  const go = document.createElement('button');
  go.type = 'submit';
  go.className = 'btn btn--sm btn--primary';
  go.textContent = submitLabel;
  foot.append(note, go);
  form.append(h, text, ...(suggestions.length ? [chips] : []), foot);
  pop.append(form);
  wrap.append(pop);

  const close = (refocus = true) => {
    if (pop.hidden) return;
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (openPopover === closeHere) openPopover = null;
    if (refocus) button.focus();
  };
  const closeHere = () => close(false);
  button.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    closeOpen();
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    openPopover = closeHere;
    text.focus();
    text.select();
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !e.shiftKey && e.target === text) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    close();
    onSubmit(text.value.trim());
  });
  return { el: wrap, close: () => close(false) };
}

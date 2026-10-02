// Canvas editor (docs/boards.md § Arranging a canvas). Loaded as an ES module
// on a board's canvas page.
//
// The board is one A2UI document (a tree). Every change is an operation the
// SERVER applies (POST /boards/:id/doc/apply — the same tree operations agents
// use), so the editor never builds layout itself: it sends {doc, ops}, gets
// back the new doc plus the redrawn surface, and shows both. Nothing is saved
// until Save (POST /boards/:id/doc with the version it loaded).
//
// Pick things in the outline (left) or by clicking a tile or section title on
// the canvas. Outline keys: ↑/↓ select, Alt+↑/↓ move within the parent,
// Delete removes, Enter focuses the selection's settings.
import { boardEdit, remountBoard } from '/assets/a2ui-sua.js';

const dataEl = document.getElementById('board-canvas-data');
const host = document.querySelector('[data-board-canvas]');
const toolbar = document.querySelector('[data-canvas-toolbar]');
const outline = document.querySelector('[data-canvas-outline]');
if (dataEl && host && toolbar && outline) init(JSON.parse(dataEl.textContent || '{}'));

function init(data) {
  const status = toolbar.querySelector('[data-canvas-status]');
  const editBtn = toolbar.querySelector('[data-canvas-edit]');
  const undoSaveBtn = toolbar.querySelector('[data-canvas-undo]');
  let doc = data.doc;
  let history = [];
  let dirty = false;
  let busy = false;
  let selected = 'root';

  const say = (msg, isError) => { status.textContent = msg || ''; status.classList.toggle('board-toolbar__status--error', Boolean(isError)); };
  const byId = () => new Map(doc.components.map((c) => [c.id, c]));
  const LIST = new Set(['Column', 'Row', 'Grid', 'List']);
  const SINGLE = new Set(['Section', 'Card', 'Cell', 'Disclosure']);
  const kids = (c) => (LIST.has(c.component) ? (c.children || []) : SINGLE.has(c.component) ? (c.child ? [c.child] : []) : c.component === 'Tabs' ? (c.tabs || []).map((t) => t.child) : []);
  const isContainer = (c) => c && (LIST.has(c.component) || SINGLE.has(c.component) || c.component === 'Tabs');
  function parents() {
    const m = new Map();
    for (const c of doc.components) kids(c).forEach((k, i) => m.set(k, { parent: c.id, index: i }));
    return m;
  }
  /** Where a node sits as placed: a tile in a Cell is placed where its Cell is. */
  function placedPos(id) {
    const ps = parents();
    const p = ps.get(id);
    if (p && byId().get(p.parent)?.component === 'Cell') return ps.get(p.parent);
    return p;
  }
  const agentName = (id) => (data.agents.find((a) => a.id === id) || {}).name || id;
  function label(c, tabTitle) {
    const pre = tabTitle ? `Tab “${tabTitle}” · ` : '';
    switch (c.component) {
      case 'Column': return pre + (c.id === 'root' ? 'Board' : 'Column');
      case 'Section': return pre + `Section “${c.title}”`;
      case 'Grid': return pre + 'Grid';
      case 'Row': return pre + 'Row';
      case 'Tabs': return pre + 'Tabs';
      case 'Card': return pre + 'Card';
      case 'Cell': return pre + `Span ${c.span || 1}${c.rows > 1 ? ` × ${c.rows} rows` : ''}`;
      case 'AgentTile': return pre + `Tile · ${agentName(c.agentId)}`;
      case 'SystemTile': return pre + `Health · ${(data.systemTiles.find((s) => s.id === c.tileId) || {}).title || c.tileId}`;
      case 'Text': return pre + (c.variant && c.variant.startsWith('h') ? `Heading “${c.text}”` : `Note “${String(c.text).slice(0, 40)}”`);
      default: return pre + c.component;
    }
  }

  // ── Outline ──────────────────────────────────────────────────────────
  function renderOutline() {
    const m = byId();
    const ul = document.createElement('ul');
    ul.className = 'canvas-outline__tree';
    ul.setAttribute('role', 'tree');
    const add = (id, depth, tabTitle) => {
      const c = m.get(id);
      if (!c) return;
      const li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      li.className = 'canvas-outline__item' + (id === selected ? ' is-selected' : '') + (isContainer(c) ? ' is-container' : '');
      li.style.paddingLeft = `${depth * 14 + 6}px`;
      li.tabIndex = id === selected ? 0 : -1;
      li.dataset.id = id;
      li.draggable = id !== 'root';
      li.textContent = label(c, tabTitle);
      li.setAttribute('aria-selected', id === selected ? 'true' : 'false');
      ul.append(li);
      if (c.component === 'Tabs') (c.tabs || []).forEach((t) => add(t.child, depth + 1, t.title));
      else kids(c).forEach((k) => add(k, depth + 1));
    };
    add('root', 0);
    outline.replaceChildren(heading('Outline'), ul, renderProps());
  }
  const heading = (text) => Object.assign(document.createElement('h2'), { className: 'canvas-outline__title', textContent: text });

  outline.addEventListener('click', (e) => {
    const li = e.target.closest('.canvas-outline__item');
    if (li) select(li.dataset.id);
  });
  outline.addEventListener('keydown', (e) => {
    const li = e.target.closest('.canvas-outline__item');
    if (!li) return;
    const items = [...outline.querySelectorAll('.canvas-outline__item')];
    const i = items.indexOf(li);
    const p = placedPos(selected);
    if (e.key === 'ArrowDown' && !e.altKey) { e.preventDefault(); if (items[i + 1]) select(items[i + 1].dataset.id, true); }
    else if (e.key === 'ArrowUp' && !e.altKey) { e.preventDefault(); if (items[i - 1]) select(items[i - 1].dataset.id, true); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && p) {
      e.preventDefault();
      const to = p.index + (e.key === 'ArrowUp' ? -1 : 2); // after removal, "down one" is index + 2 - 1
      if (to < 0) return;
      apply([{ op: 'move', id: selected, parent: p.parent, index: e.key === 'ArrowUp' ? to : to - 1 }], { keep: true });
    } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
    else if (e.key === 'Enter') { e.preventDefault(); outline.querySelector('.canvas-props input, .canvas-props select')?.focus(); }
  });
  // Drag in the outline: drop on a container to move into it, on anything else to move before it.
  let dragId = '';
  outline.addEventListener('dragstart', (e) => { const li = e.target.closest('.canvas-outline__item'); if (li) { dragId = li.dataset.id; e.dataTransfer.effectAllowed = 'move'; } });
  outline.addEventListener('dragover', (e) => { if (dragId && e.target.closest('.canvas-outline__item')) { e.preventDefault(); e.target.closest('.canvas-outline__item').classList.add('is-drop'); } });
  outline.addEventListener('dragleave', (e) => e.target.closest?.('.canvas-outline__item')?.classList.remove('is-drop'));
  outline.addEventListener('drop', (e) => {
    const li = e.target.closest('.canvas-outline__item');
    if (!li || !dragId) return;
    e.preventDefault();
    const target = byId().get(li.dataset.id);
    const moving = dragId;
    dragId = '';
    if (!target || target.id === moving) return renderOutline();
    if (isContainer(target) && target.component !== 'Cell') apply([{ op: 'move', id: moving, parent: target.id }], { select: moving });
    else {
      const pp = placedPos(target.id);
      if (pp) apply([{ op: 'move', id: moving, parent: pp.parent, index: pp.index }], { select: moving });
    }
  });

  // ── Selection ────────────────────────────────────────────────────────
  function select(id, focus) {
    selected = id;
    boardEdit.selected = id;
    renderOutline();
    redraw();
    if (focus) outline.querySelector('.canvas-outline__item.is-selected')?.focus();
  }
  host.addEventListener('sua-board-select', (e) => { if (e.detail?.id) select(e.detail.id); });

  // ── Settings for the selection ───────────────────────────────────────
  function renderProps() {
    const box = document.createElement('div');
    box.className = 'canvas-props';
    const c = byId().get(selected);
    if (!c) return box;
    const tile = c.component === 'Cell' ? byId().get(c.child) : c;
    const p = parents().get(selected);
    const inGrid = p && (byId().get(p.parent)?.component === 'Grid' || byId().get(p.parent)?.component === 'Cell');
    const field = (labelText, el) => { const l = document.createElement('label'); l.className = 'canvas-props__field'; l.append(Object.assign(document.createElement('span'), { textContent: labelText }), el); return l; };
    const text = (value, onChange) => { const i = document.createElement('input'); i.type = 'text'; i.value = value || ''; i.addEventListener('change', () => onChange(i.value.trim())); return i; };
    const sel = (opts, value, onChange) => { const s = document.createElement('select'); for (const [v, t] of opts) s.append(new Option(t, v, false, String(v) === String(value))); s.addEventListener('change', () => onChange(s.value)); return s; };
    box.append(heading('Selected: ' + label(c)));
    if (tile?.component === 'Section') box.append(field('Title', text(tile.title, (v) => v && apply([{ op: 'set', id: tile.id, props: { title: v } }], { keep: true }))));
    if (tile?.component === 'Text') box.append(field('Text', text(tile.text, (v) => v && apply([{ op: 'set', id: tile.id, props: { text: v } }], { keep: true }))));
    if (tile?.component === 'Grid') box.append(field('Tile width', sel([[200, 'Narrow (200px)'], [280, 'Normal (280px)'], [360, 'Wide (360px)'], [480, 'Very wide (480px)']], tile.minWidth || 280, (v) => apply([{ op: 'set', id: tile.id, props: { minWidth: Number(v) } }], { keep: true }))));
    if (tile?.component === 'Tabs') (tile.tabs || []).forEach((t, i) => box.append(field(`Tab ${i + 1} title`, text(t.title, (v) => { if (!v) return; const titles = tile.tabs.map((x) => x.title); titles[i] = v; apply([{ op: 'set', id: tile.id, props: { tabTitles: titles } }], { keep: true }); }))));
    if (tile && (tile.component === 'AgentTile' || tile.component === 'SystemTile')) {
      box.append(field('Palette', sel([['default', 'Default'], ['dark', 'Dark'], ['light', 'Light'], ['accent-teal', 'Teal'], ['accent-red', 'Red'], ['accent-green', 'Green']], tile.palette || 'default', (v) => apply([{ op: 'set', id: tile.id, props: { palette: v } }], { keep: true }))));
      if (inGrid) {
        const cell = c.component === 'Cell' ? c : null;
        box.append(field('Width', sel([[1, '1 column'], [2, '2 columns'], [3, '3 columns'], [4, '4 columns']], cell?.span || 1, (v) => apply([{ op: 'span', id: tile.id, span: Number(v), rows: cell?.rows || 1 }], { select: tile.id }))));
        box.append(field('Height', sel([[1, '1 row'], [2, '2 rows'], [3, '3 rows']], cell?.rows || 1, (v) => apply([{ op: 'span', id: tile.id, span: cell?.span || 1, rows: Number(v) }], { select: tile.id }))));
      }
    }
    return box;
  }

  // ── Operations (applied by the server) ───────────────────────────────
  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    let json = {};
    try { json = await res.json(); } catch { /* empty */ }
    return { ok: res.ok, status: res.status, json };
  }
  async function apply(ops, opts = {}) {
    if (busy) return;
    busy = true;
    try {
      const out = await post(`/boards/${encodeURIComponent(data.id)}/doc/apply`, { doc, ops });
      if (!out.ok) { say(out.json.error || 'That change didn’t work.', true); return; }
      history.push(doc);
      doc = out.json.doc;
      dirty = true;
      saveBtn.disabled = false;
      undoEditBtn.disabled = false;
      const ids = new Set(doc.components.map((c) => c.id));
      selected = opts.select && ids.has(opts.select) ? opts.select : out.json.created?.[0] || (opts.keep && ids.has(selected) ? selected : 'root');
      boardEdit.selected = selected;
      remountBoard(host, out.json.messages, out.json.tiles);
      renderOutline();
      say('Unsaved changes');
    } finally { busy = false; }
  }
  function redraw() {
    const script = host.querySelector('script[type="application/json"]');
    remountBoard(host, JSON.parse(script.textContent || '[]'));
  }
  /** Where an added thing goes: into the selection if it holds things, else just after it. */
  function target() {
    const c = byId().get(selected);
    if (isContainer(c) && c.component !== 'Cell') return { parent: c.id };
    const p = placedPos(selected);
    return p ? { parent: p.parent, index: p.index + 1 } : { parent: 'root' };
  }
  function removeSelected() {
    if (selected === 'root') { say('The board itself can’t be removed.', true); return; }
    apply([{ op: 'remove', id: selected }]);
  }

  // ── Toolbar ──────────────────────────────────────────────────────────
  const btn = (text, cls = 'btn--ghost') => Object.assign(document.createElement('button'), { type: 'button', className: `btn btn--sm ${cls}`, textContent: text });
  const menu = (labelText, options, onPick) => {
    const s = document.createElement('select');
    s.className = 'board-toolbar__select';
    s.setAttribute('aria-label', labelText);
    s.append(new Option(labelText, ''));
    for (const [v, t] of options) s.append(new Option(t, v));
    s.addEventListener('change', () => { const v = s.value; s.value = ''; if (v) onPick(v); });
    return s;
  };
  const addMenu = menu('+ Add…', [
    ['section', 'Section'], ['heading', 'Heading'], ['note', 'Note'], ['grid', 'Grid of tiles'], ['row', 'Row'], ['tabs', 'Tabs'], ['card', 'Card'],
    ...(data.systemTiles.length ? [['system', 'Health tile…']] : []),
  ], (kind) => {
    const t = target();
    if (kind === 'section') return apply([{ op: 'insert', ...t, node: { type: 'section', title: 'New section' } }]);
    if (kind === 'heading') return apply([{ op: 'insert', ...t, node: { type: 'heading', text: 'Heading' } }]);
    if (kind === 'note') return apply([{ op: 'insert', ...t, node: { type: 'note', text: 'A note' } }]);
    if (kind === 'system') {
      const used = new Set(doc.components.filter((c) => c.component === 'SystemTile').map((c) => c.tileId));
      const free = data.systemTiles.find((s) => !used.has(s.id));
      if (!free) { say('Every health tile is already on the board.', true); return; }
      return apply([{ op: 'insert', ...t, node: { type: 'system', tileId: free.id } }]);
    }
    return apply([{ op: 'insert', ...t, node: { type: kind } }]);
  });
  const tileMenu = menu('+ Agent tile…', data.agents.map((a) => [a.id, a.name]), (agentId) => apply([{ op: 'insert', ...target(), node: { type: 'tile', agentId } }]));
  const wrapMenu = menu('Wrap in…', [['section', 'Section'], ['card', 'Card'], ['row', 'Row'], ['column', 'Column'], ['tabs', 'Tabs']], (kind) => {
    if (selected === 'root') { say('Pick something inside the board to wrap.', true); return; }
    apply([{ op: 'wrap', id: selected, in: kind, ...(kind === 'section' ? { title: 'New section' } : {}) }], { keep: true });
  });
  const unwrapBtn = btn('Unwrap');
  unwrapBtn.title = 'Put this container’s contents where it is';
  unwrapBtn.addEventListener('click', () => apply([{ op: 'unwrap', id: selected }]));
  const removeBtn = btn('Remove');
  removeBtn.addEventListener('click', removeSelected);
  const undoEditBtn = btn('↶ Undo');
  undoEditBtn.title = 'Undo your last change (not saved yet)';
  undoEditBtn.disabled = true;
  undoEditBtn.addEventListener('click', async () => {
    const prev = history.pop();
    if (!prev) return;
    const out = await post(`/boards/${encodeURIComponent(data.id)}/doc/apply`, { doc: prev, ops: [] }).catch(() => null);
    doc = prev;
    if (out?.ok) remountBoard(host, out.json.messages, out.json.tiles);
    undoEditBtn.disabled = history.length === 0;
    dirty = history.length > 0;
    saveBtn.disabled = !dirty;
    selected = 'root'; boardEdit.selected = 'root';
    renderOutline();
    say(dirty ? 'Unsaved changes' : '');
  });
  const saveBtn = btn('Save', 'btn--primary');
  saveBtn.disabled = true;
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    say('Saving…');
    const out = await post(`/boards/${encodeURIComponent(data.id)}/doc`, { doc, version: data.version });
    if (out.ok) { dirty = false; location.reload(); return; }
    saveBtn.disabled = false;
    say(out.status === 409 ? 'This board changed somewhere else. Reload to see it, then make your change again.' : (out.json.error || 'Couldn’t save.'), true);
  });
  const doneBtn = btn('Cancel');
  doneBtn.addEventListener('click', () => { if (!dirty || window.confirm('Discard your changes to this board?')) location.reload(); });
  const editOnly = [addMenu, tileMenu, wrapMenu, unwrapBtn, removeBtn, undoEditBtn, saveBtn, doneBtn];
  for (const el of editOnly) { el.hidden = true; toolbar.insertBefore(el, status); }

  function enterEdit() {
    if (boardEdit.on) return true;
    if (window.matchMedia('(max-width: 900px)').matches) { say('Boards can be arranged on a wider screen.', true); return false; }
    boardEdit.on = true;
    boardEdit.selected = selected;
    editBtn.hidden = true;
    if (undoSaveBtn) undoSaveBtn.hidden = true;
    if (suggestBtn) suggestBtn.hidden = true;
    for (const el of editOnly) el.hidden = false;
    outline.hidden = false;
    document.querySelector('[data-canvas-workspace]')?.classList.add('canvas-workspace--editing');
    renderOutline();
    redraw();
    return true;
  }
  editBtn.addEventListener('click', () => {
    if (enterEdit()) say('Pick something in the outline or on the board, then add, move, wrap or remove.');
  });

  // ── Suggest a layout: the layout planner's plan, opened as unsaved changes ─
  const suggestBtn = toolbar.querySelector('[data-canvas-suggest]');
  suggestBtn?.addEventListener('click', async () => {
    if (dirty) { say('Save or cancel your changes first.', true); return; }
    suggestBtn.disabled = true;
    say('Asking the layout planner…');
    try {
      const start = await post(data.plannerUrl, { focus: '' });
      if (!start.ok || !start.json.ok) throw new Error(start.json.error || 'The layout planner didn’t start.');
      let plan = null;
      for (let i = 0; i < 150 && !plan; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const json = await (await fetch(`${data.plannerUrl}/${encodeURIComponent(start.json.runId)}`, { headers: { Accept: 'application/json' } })).json();
        if (json.status === 'done') plan = json.plan;
        else if (json.status === 'failed' || json.status === 'not_found' || json.ok === false) throw new Error(json.error || 'The layout planner failed.');
        else say(json.phase || 'Designing layout…');
      }
      if (!plan) throw new Error('The layout planner took too long.');
      const preview = await post(`/boards/${encodeURIComponent(data.id)}/plan-preview`, { plan });
      if (!preview.ok) throw new Error(preview.json.error || 'Couldn’t use that layout.');
      const drawn = await post(`/boards/${encodeURIComponent(data.id)}/doc/apply`, { doc: preview.json.doc, ops: [] });
      if (!drawn.ok) throw new Error(drawn.json.error || 'Couldn’t draw that layout.');
      if (!enterEdit()) return;
      history.push(doc);
      doc = drawn.json.doc;
      dirty = true; saveBtn.disabled = false; undoEditBtn.disabled = false;
      selected = 'root'; boardEdit.selected = 'root';
      remountBoard(host, drawn.json.messages, drawn.json.tiles);
      renderOutline();
      say('Suggested layout' + (preview.json.summary ? `: ${preview.json.summary}` : '') + ' Adjust it, then Save, or Cancel to keep your board as it was.');
    } catch (err) {
      say(err && err.message ? err.message : 'Couldn’t suggest a layout.', true);
    } finally { suggestBtn.disabled = false; }
  });

  // ── One-time: start Pulse from the old Pulse's arrangement in this browser ─
  if (data.offerImport) {
    let layout = null;
    let sizes = {};
    try { layout = JSON.parse(localStorage.getItem('sua-pulse-layout') || 'null'); } catch { layout = null; }
    try { sizes = JSON.parse(localStorage.getItem('sua-pulse-layout-sizes') || localStorage.getItem('sua-pulse-sizes') || '{}') || {}; } catch { sizes = {}; }
    const AUTO = ['health', 'recent', 'idle', 'never-run', 'agents', '_other'];
    const containers = layout && Array.isArray(layout.containers) ? layout.containers : [];
    if (containers.some((c) => c && !AUTO.includes(c.id)) || Object.keys(sizes).length > 0) {
      const b = btn('Start from my Pulse arrangement');
      b.title = 'Use the groups and tile sizes this browser saved for the old Pulse';
      toolbar.insertBefore(b, status);
      b.addEventListener('click', async () => {
        b.disabled = true;
        const out = await post('/boards/pulse/import', { containers, sizes });
        if (out.ok) { location.reload(); return; }
        b.disabled = false;
        say(out.json.error || 'Couldn’t import.', true);
      });
    }
  }
  undoSaveBtn?.addEventListener('click', async () => {
    undoSaveBtn.disabled = true;
    const out = await post(`/boards/${encodeURIComponent(data.id)}/undo`, { version: data.version });
    if (out.ok) { location.reload(); return; }
    undoSaveBtn.disabled = false;
    say(out.json.error || 'Couldn’t undo.', true);
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}

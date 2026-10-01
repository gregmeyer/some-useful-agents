// Board editor (W4b, docs/boards.md). Loaded as an ES module on /boards/:id.
//
// Outside edit mode a board is plain server-rendered CSS grid and this module
// only wires the Edit / Undo buttons. In edit mode every item gets a cover
// with a move area, a resize corner and a remove button; tiles can be moved
// and resized with the mouse or keyboard (arrows move, Shift+arrows resize,
// Delete removes). Changes stay local until Save, which posts the whole board
// with the version it was loaded at (a stale save is refused, not merged).
//
// Tiles settle the same way the server settles them (core/src/boards.ts
// normalizeBoardItems): no overlaps, everything floats up into gaps. The item
// being moved wins ties, so dropping it on another tile's top row pushes that
// tile down.

const dataEl = document.getElementById('board-data');
const root = document.querySelector('.board[data-board-id]');
const toolbar = document.querySelector('[data-board-toolbar]');

if (dataEl && root && toolbar) init(JSON.parse(dataEl.textContent || '{}'));

function init(data) {
  const COLS = data.columns || 12;
  const ROW = data.rowPx || 40;
  const status = toolbar.querySelector('[data-board-status]');
  let items = (data.items || []).map((it) => ({ ...it }));
  let editing = false;
  let dirty = false;

  const say = (msg, isError) => {
    status.textContent = msg || '';
    status.classList.toggle('board-toolbar__status--error', Boolean(isError));
  };

  // ── Layout (mirrors normalizeBoardItems) ───────────────────────────────
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  function settle(priorityId) {
    const order = items
      .map((it) => ({ ...it, w: Math.min(Math.max(1, it.w), COLS), x: Math.max(0, Math.min(it.x, COLS - Math.min(Math.max(1, it.w), COLS))), y: Math.max(0, it.y), h: Math.max(1, it.h) }))
      .sort((a, b) => a.y - b.y || (a.id === priorityId ? -1 : b.id === priorityId ? 1 : 0) || a.x - b.x);
    const placed = [];
    for (const cur of order) {
      while (cur.y > 0 && !placed.some((p) => overlaps({ ...cur, y: cur.y - 1 }, p))) cur.y -= 1;
      let hit = placed.find((p) => overlaps(cur, p));
      while (hit) { cur.y = hit.y + hit.h; hit = placed.find((p) => overlaps(cur, p)); }
      placed.push(cur);
    }
    items = placed.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  // ── DOM ────────────────────────────────────────────────────────────────
  function grid() {
    let g = root.querySelector('.board-grid');
    if (!g) {
      g = document.createElement('div');
      g.className = 'board-grid';
      g.style.setProperty('--board-row', ROW + 'px');
      const empty = root.querySelector('.board-empty');
      if (empty) empty.replaceWith(g); else root.prepend(g);
    }
    return g;
  }
  const el = (id) => root.querySelector('.board-item[data-board-item="' + CSS.escape(id) + '"]');
  const describe = (it) => {
    const what = it.kind === 'heading' ? 'Heading “' + it.text + '”' : it.kind === 'note' ? 'Note' : (it.agentId || it.tileId);
    return what + ': column ' + (it.x + 1) + ', row ' + (it.y + 1) + ', ' + it.w + ' wide, ' + it.h + ' tall';
  };
  function paint() {
    for (const it of items) {
      const node = el(it.id);
      if (!node) continue;
      node.style.gridColumn = (it.x + 1) + ' / span ' + it.w;
      node.style.gridRow = (it.y + 1) + ' / span ' + it.h;
      const cover = node.querySelector('.board-item__cover');
      if (cover) cover.setAttribute('aria-label', describe(it) + '. Arrows move, Shift+arrows resize, Delete removes.');
    }
  }
  function changed(priorityId, focusId) {
    settle(priorityId);
    paint();
    dirty = true;
    saveBtn.disabled = false;
    say('Unsaved changes');
    if (focusId) el(focusId)?.querySelector('.board-item__cover')?.focus();
  }

  // ── Edit chrome ────────────────────────────────────────────────────────
  function addCover(node) {
    if (node.querySelector('.board-item__cover')) return;
    const id = node.getAttribute('data-board-item');
    const cover = document.createElement('div');
    cover.className = 'board-item__cover';
    cover.tabIndex = 0;
    cover.setAttribute('role', 'group');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'board-item__remove';
    remove.title = 'Remove from the board';
    remove.setAttribute('aria-label', 'Remove');
    remove.textContent = '×';
    remove.addEventListener('click', (e) => { e.stopPropagation(); removeItem(id); });
    const corner = document.createElement('span');
    corner.className = 'board-item__resize';
    corner.title = 'Drag to resize';
    cover.append(remove, corner);
    cover.addEventListener('pointerdown', (e) => startPointer(e, id, e.target === corner ? 'resize' : 'move'));
    cover.addEventListener('keydown', (e) => onKey(e, id));
    node.append(cover);
  }
  function setEditing(on) {
    editing = on;
    root.classList.toggle('board--editing', on);
    toolbar.classList.toggle('board-toolbar--editing', on);
    editBtn.hidden = on;
    for (const b of editOnly) b.hidden = !on;
    if (undoBtn) undoBtn.hidden = on;
    if (on) {
      root.querySelectorAll('.board-item').forEach(addCover);
      paint();
      say('Drag tiles to move them, drag a corner to resize, or use the keyboard.');
    }
    trayButtons(on);
  }

  // ── Pointer: move / resize ─────────────────────────────────────────────
  function cellSize() {
    const g = grid();
    const rect = g.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(g).columnGap) || 0;
    const rowGap = parseFloat(getComputedStyle(g).rowGap) || 0;
    return { rect, colW: (rect.width + gap) / COLS, rowH: ROW + rowGap };
  }
  function startPointer(e, id, mode) {
    if (!editing || e.button !== 0 || e.target.closest('.board-item__remove')) return;
    const it = items.find((i) => i.id === id);
    if (!it) return;
    e.preventDefault();
    const node = el(id);
    const { rect, colW, rowH } = cellSize();
    const grabX = Math.floor((e.clientX - rect.left) / colW) - it.x;
    const grabY = Math.floor((e.clientY - rect.top) / rowH) - it.y;
    node.classList.add('board-item--active');
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { /* synthetic or lost pointer */ }
    let last = '';
    const onMove = (ev) => {
      const { rect: r, colW: cw, rowH: rh } = cellSize();
      const cur = items.find((i) => i.id === id);
      if (mode === 'move') {
        cur.x = Math.max(0, Math.min(COLS - cur.w, Math.floor((ev.clientX - r.left) / cw) - grabX));
        cur.y = Math.max(0, Math.floor((ev.clientY - r.top) / rh) - grabY);
      } else {
        cur.w = Math.max(1, Math.min(COLS - cur.x, Math.round((ev.clientX - r.left) / cw) - cur.x));
        cur.h = Math.max(1, Math.min(60, Math.round((ev.clientY - r.top) / rh) - cur.y));
      }
      const key = cur.x + ',' + cur.y + ',' + cur.w + ',' + cur.h;
      if (key !== last) { last = key; changed(id); }
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      node.classList.remove('board-item--active');
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────
  const colsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w;
  function onKey(e, id) {
    if (!editing) return;
    const it = items.find((i) => i.id === id);
    if (!it) return;
    let handled = true;
    if (e.key === 'Delete' || e.key === 'Backspace') { removeItem(id); e.preventDefault(); return; }
    if (e.shiftKey) {
      if (e.key === 'ArrowRight') it.w = Math.min(COLS - it.x, it.w + 1);
      else if (e.key === 'ArrowLeft') it.w = Math.max(1, it.w - 1);
      else if (e.key === 'ArrowDown') it.h = Math.min(60, it.h + 1);
      else if (e.key === 'ArrowUp') it.h = Math.max(1, it.h - 1);
      else handled = false;
    } else if (e.key === 'ArrowRight') it.x = Math.min(COLS - it.w, it.x + 1);
    else if (e.key === 'ArrowLeft') it.x = Math.max(0, it.x - 1);
    else if (e.key === 'ArrowUp') {
      // Swap with the nearest tile above in the same columns.
      const above = items.filter((o) => o.id !== id && colsOverlap(o, it) && o.y + o.h <= it.y).sort((a, b) => b.y - a.y)[0];
      it.y = above ? above.y : Math.max(0, it.y - 1);
    } else if (e.key === 'ArrowDown') {
      // Swap with the nearest tile below in the same columns.
      const below = items.filter((o) => o.id !== id && colsOverlap(o, it) && o.y >= it.y + it.h).sort((a, b) => a.y - b.y)[0];
      if (below) it.y = below.y + 1;
    } else handled = false;
    if (!handled) return;
    e.preventDefault();
    changed(id, id);
    say(describe(items.find((i) => i.id === id)));
  }

  // ── Add / remove ───────────────────────────────────────────────────────
  const SPANS = { '2x1': [6, 5], '1x2': [3, 10], '2x2': [6, 10] };
  const span = (size) => SPANS[size] || [3, 5];
  const bottom = () => items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  // First free w×h spot, top to bottom then left to right (else a new row).
  function freeSpot(w, h) {
    const end = bottom();
    for (let y = 0; y <= end; y++) {
      for (let x = 0; x + w <= COLS; x++) {
        const probe = { x, y, w, h };
        if (!items.some((o) => overlaps(probe, o))) return { x, y };
      }
    }
    return { x: 0, y: end };
  }
  const newId = (prefix) => {
    let n = items.length + 1;
    while (items.some((i) => i.id === prefix + n)) n += 1;
    return prefix + n;
  };
  function wrap(id, kind, child) {
    const node = document.createElement('div');
    node.className = 'board-item board-item--' + kind;
    node.setAttribute('data-board-item', id);
    node.append(child);
    grid().append(node);
    addCover(node);
    return node;
  }
  function addItem(item, child) {
    items.push(item);
    wrap(item.id, item.kind, child);
    changed(item.id, item.id);
  }
  function addText(kind) {
    const input = toolbar.querySelector('[data-board-text]');
    const text = input.value.trim();
    if (!text) { say('Type the ' + kind + ' text first.', true); input.focus(); return; }
    const child = document.createElement(kind === 'heading' ? 'h2' : 'div');
    child.className = kind === 'heading' ? 'board-heading' : 'board-note';
    child.textContent = text;
    addItem(kind === 'heading'
      ? { id: newId('h'), kind: 'heading', text: text.slice(0, 120), x: 0, y: bottom(), w: COLS, h: 1 }
      : { id: newId('n'), kind: 'note', text: text.slice(0, 4000), ...freeSpot(4, 3), w: 4, h: 3 }, child);
    input.value = '';
  }
  async function addAgent(agentId) {
    const res = await fetch('/pulse/tile/' + encodeURIComponent(agentId), { headers: { Accept: 'text/html' } });
    if (!res.ok) { say('Couldn’t load that tile.', true); return; }
    const holder = document.createElement('div');
    holder.innerHTML = await res.text();
    const tile = holder.firstElementChild;
    if (!tile) return;
    const [w, h] = span((data.agents.find((a) => a.id === agentId) || {}).size);
    addItem({ id: newId('a'), kind: 'agent', agentId, ...freeSpot(w, h), w, h }, tile);
    const opt = toolbar.querySelector('[data-board-agent] option[value="' + CSS.escape(agentId) + '"]');
    if (opt) opt.remove();
  }
  function placeFromTray(tile) {
    const tileId = tile.getAttribute('data-agent-id');
    const isSystem = tileId.startsWith('_');
    const [w, h] = span(data.sizes[tileId] || tile.getAttribute('data-tile-size'));
    tile.querySelector('.board-tray__place')?.remove();
    addItem(isSystem
      ? { id: newId('s'), kind: 'system', tileId, ...freeSpot(w, h), w, h }
      : { id: newId('a'), kind: 'agent', agentId: tileId, ...freeSpot(w, h), w, h }, tile);
    updateTrayCounts();
  }
  function removeItem(id) {
    const it = items.find((i) => i.id === id);
    const node = el(id);
    items = items.filter((i) => i.id !== id);
    if (node) {
      const tile = node.querySelector('.pulse-tile');
      const tray = root.querySelector('.board-tray__grid');
      // On Pulse a removed tile goes back to the tray rather than vanishing.
      if (data.isPulse && tile && tray) { tray.prepend(tile); addPlaceButton(tile); updateTrayCounts(); }
      node.remove();
    }
    changed();
    say('Removed ' + (it ? describe(it).split(':')[0] : 'tile') + '.');
  }

  // ── Pulse's Unplaced tray ──────────────────────────────────────────────
  function addPlaceButton(tile) {
    if (tile.querySelector('.board-tray__place')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--primary btn--sm board-tray__place';
    b.textContent = 'Place on board';
    b.hidden = !editing;
    b.addEventListener('click', () => placeFromTray(tile));
    tile.prepend(b);
  }
  function trayButtons(on) {
    root.querySelectorAll('.board-tray .pulse-tile').forEach((tile) => {
      addPlaceButton(tile);
      tile.querySelector('.board-tray__place').hidden = !on;
    });
  }
  function updateTrayCounts() {
    root.querySelectorAll('.board-tray__group').forEach((g) => {
      const n = g.querySelectorAll('.pulse-tile').length;
      const c = g.querySelector('.pulse-container__count');
      if (c) c.textContent = String(n);
    });
  }

  // ── Save / cancel / undo ───────────────────────────────────────────────
  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    let json = {};
    try { json = await res.json(); } catch { /* empty */ }
    return { ok: res.ok, status: res.status, json };
  }
  async function save() {
    saveBtn.disabled = true;
    say('Saving…');
    const out = await post('/boards/' + encodeURIComponent(data.id), { items, version: data.version });
    if (out.ok) { dirty = false; location.reload(); return; }
    saveBtn.disabled = false;
    say(out.status === 409 ? 'This board changed somewhere else. Reload to see it, then make your change again.' : (out.json.error || 'Couldn’t save.'), true);
  }

  // ── Toolbar ────────────────────────────────────────────────────────────
  const btn = (label, cls, attr) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--sm ' + cls;
    b.textContent = label;
    if (attr) b.setAttribute(attr, '');
    return b;
  };
  const editBtn = toolbar.querySelector('[data-board-edit]');
  const undoBtn = toolbar.querySelector('[data-board-undo]');
  const saveBtn = btn('Save', 'btn--primary', 'data-board-save');
  const cancelBtn = btn('Cancel', 'btn--ghost');
  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'board-toolbar__text';
  text.placeholder = 'Heading or note text';
  text.setAttribute('aria-label', 'Heading or note text');
  text.setAttribute('data-board-text', '');
  text.maxLength = 4000;
  const headingBtn = btn('+ Heading', 'btn--ghost');
  const noteBtn = btn('+ Note', 'btn--ghost');
  const editOnly = [saveBtn, cancelBtn, text, headingBtn, noteBtn];
  if (!data.isPulse && data.agents && data.agents.length) {
    const select = document.createElement('select');
    select.className = 'board-toolbar__select';
    select.setAttribute('data-board-agent', '');
    select.setAttribute('aria-label', 'Add an agent tile');
    select.innerHTML = '<option value="">+ Agent tile…</option>';
    for (const a of data.agents) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name;
      select.append(o);
    }
    select.addEventListener('change', () => { if (select.value) addAgent(select.value); select.value = ''; });
    editOnly.push(select);
  }
  saveBtn.disabled = true;
  for (const b of editOnly) { b.hidden = true; toolbar.insertBefore(b, status); }
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addText('heading'); } });
  headingBtn.addEventListener('click', () => addText('heading'));
  noteBtn.addEventListener('click', () => addText('note'));
  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', () => { if (!dirty || window.confirm('Discard your changes to this board?')) location.reload(); });
  editBtn.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 900px)').matches) { say('Boards can be arranged on a wider screen.', true); return; }
    setEditing(true);
  });
  undoBtn?.addEventListener('click', async () => {
    undoBtn.disabled = true;
    const out = await post('/boards/' + encodeURIComponent(data.id) + '/undo', { version: data.version });
    if (out.ok) { location.reload(); return; }
    undoBtn.disabled = false;
    say(out.json.error || 'Couldn’t undo.', true);
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  if (data.isPulse && data.version === 0) offerImport();

  // ── One-time import of the old Pulse arrangement (this browser) ────────
  function offerImport() {
    let layout = null;
    let sizes = {};
    try { layout = JSON.parse(localStorage.getItem('sua-pulse-layout') || 'null'); } catch { layout = null; }
    try { sizes = JSON.parse(localStorage.getItem('sua-pulse-layout-sizes') || localStorage.getItem('sua-pulse-sizes') || '{}') || {}; } catch { sizes = {}; }
    const AUTO = ['health', 'recent', 'idle', 'never-run', 'agents', '_other'];
    const containers = layout && Array.isArray(layout.containers) ? layout.containers : [];
    const custom = containers.some((c) => c && !AUTO.includes(c.id)) || Object.keys(sizes).length > 0;
    if (!custom) return;
    const b = btn('Start from my Pulse arrangement', 'btn--ghost', 'data-board-import');
    b.title = 'Use the groups and tile sizes this browser saved for Pulse';
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

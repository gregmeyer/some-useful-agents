/**
 * Shared widget layout JS: containers, drag-and-drop, palette cycling, tile resize.
 *
 * Parameterized so both Pulse and the home page (and future widget surfaces)
 * can share the same drag-drop / resize / container logic with different
 * element IDs and localStorage keys.
 */

export interface WidgetLayoutConfig {
  /** Prefix used for CSS classes and data attributes, e.g. 'pulse' or 'home'. */
  prefix: string;
  /** localStorage key for the layout JSON, e.g. 'sua-pulse-layout'. */
  storageKey: string;
  /** ID of the host element that holds all containers, e.g. 'pulse-containers'. */
  hostId: string;
  /** ID of the script/json element with tile data, e.g. 'pulse-tile-data'. */
  dataId: string;
  /** ID of the edit toggle button, e.g. 'pulse-edit-toggle'. */
  editToggleId: string;
  /** ID of the add-container button, e.g. 'pulse-add-container'. */
  addContainerId: string;
  /** Tile IDs that cannot be deleted in edit mode (e.g. system widgets). */
  protectedPrefixes?: string[];
  /** Default container layout when none exists in localStorage. */
  defaultContainers?: (allIds: string[], systemIds: string[]) => Array<{ id: string; label: string; tiles: string[] }>;
  /** Override localStorage key for palette data. Defaults to `${storageKey}-palettes`. */
  paletteKey?: string;
  /** Override localStorage key for tile sizes. Defaults to `${storageKey}-sizes`. */
  sizesKey?: string;
  /** Override localStorage key for collapsed state. Defaults to `${storageKey}-collapsed`. */
  collapsedKey?: string;
}

export function widgetLayoutJS(config: WidgetLayoutConfig): string {
  const protectedPrefixes = JSON.stringify(config.protectedPrefixes ?? []);
  const hasCustomDefault = !!config.defaultContainers;
  const paletteKey = config.paletteKey ?? `${config.storageKey}-palettes`;
  const sizesKey = config.sizesKey ?? `${config.storageKey}-sizes`;
  const collapsedKey = config.collapsedKey ?? `${config.storageKey}-collapsed`;

  return `
  // ── Widget layout: containers, drag-and-drop, palette (${config.prefix}) ──
  (function () {
    var host = document.getElementById('${config.hostId}');
    var dataEl = document.getElementById('${config.dataId}');
    if (!host || !dataEl) return;

    var tileData = JSON.parse(dataEl.textContent || '{}');
    var allIds = tileData.allTileIds || [];
    var systemIds = tileData.systemTileIds || [];
    var protectedPrefixes = ${protectedPrefixes};

    var LAYOUT_KEY = '${config.storageKey}';
    var PALETTE_KEY = '${paletteKey}';
    var SIZES_KEY = '${sizesKey}';
    var COLLAPSED_KEY = '${collapsedKey}';
    var PALETTES = ['default', 'dark', 'light', 'accent-teal', 'accent-red', 'accent-green'];

    function isProtected(id) {
      for (var i = 0; i < protectedPrefixes.length; i++) {
        if (id.indexOf(protectedPrefixes[i]) === 0) return true;
      }
      return false;
    }

    function getLayout() {
      try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch { return null; }
    }
    function saveLayout(layout) {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
    }
    function getPalettes() {
      try { return JSON.parse(localStorage.getItem(PALETTE_KEY) || '{}'); } catch { return {}; }
    }
    function savePalettes(p) {
      try { localStorage.setItem(PALETTE_KEY, JSON.stringify(p)); } catch {}
    }

    // Build default layout if none exists.
    var layout = getLayout();
    if (!layout || !layout.containers) {
      ${hasCustomDefault ? `layout = { containers: (${config.defaultContainers!.toString()})(allIds, systemIds) };` : `layout = {
        containers: [
          { id: 'health', label: 'Health', tiles: systemIds.slice() },
          { id: 'agents', label: 'Agents', tiles: allIds.filter(function(id) { return systemIds.indexOf(id) === -1; }) }
        ]
      };`}
      saveLayout(layout);
    }

    // Merge any new tiles not in the layout into an "Other" container.
    var assigned = {};
    for (var ci = 0; ci < layout.containers.length; ci++) {
      for (var ti = 0; ti < layout.containers[ci].tiles.length; ti++) {
        assigned[layout.containers[ci].tiles[ti]] = true;
      }
    }
    var unassigned = allIds.filter(function(id) { return !assigned[id]; });
    if (unassigned.length > 0) {
      var other = layout.containers.find(function(c) { return c.id === '_other'; });
      if (!other) {
        other = { id: '_other', label: 'Other', tiles: [] };
        layout.containers.push(other);
      }
      for (var u = 0; u < unassigned.length; u++) other.tiles.push(unassigned[u]);
      saveLayout(layout);
    }

    // Get all rendered tiles by agent ID.
    var tileEls = {};
    var allTileNodes = host.querySelectorAll('.pulse-tile[data-agent-id]');
    for (var i = 0; i < allTileNodes.length; i++) {
      tileEls[allTileNodes[i].getAttribute('data-agent-id')] = allTileNodes[i];
    }

    // Apply palettes: auto-palette as default, manual overrides on top.
    var palettes = getPalettes();
    for (var aid in tileEls) {
      var manual = palettes[aid];
      if (manual && manual !== 'default') {
        tileEls[aid].setAttribute('data-palette', manual);
      } else if (!manual) {
        var auto = tileEls[aid].getAttribute('data-auto-palette');
        if (auto) tileEls[aid].setAttribute('data-palette', auto);
      }
    }

    // Re-render containers from layout.
    function renderLayout() {
      host.innerHTML = '';
      for (var ci = 0; ci < layout.containers.length; ci++) {
        var c = layout.containers[ci];
        var section = document.createElement('section');
        section.className = 'pulse-container';
        section.setAttribute('data-container-id', c.id);

        // Header.
        var header = document.createElement('div');
        header.className = 'pulse-container__header';
        var label = document.createElement('span');
        label.className = 'pulse-container__label';
        label.contentEditable = 'true';
        label.textContent = c.label;
        label.addEventListener('blur', (function(cont) { return function(e) {
          cont.label = e.target.textContent.trim() || cont.label;
          saveLayout(layout);
        }; })(c));
        label.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });
        header.appendChild(label);

        var delBtn = document.createElement('button');
        delBtn.className = 'pulse-container__delete';
        delBtn.title = 'Remove group';
        delBtn.textContent = '\\u00D7';
        delBtn.addEventListener('click', (function(cont) { return function() {
          // Move tiles to Other.
          var otherCont = layout.containers.find(function(x) { return x.id === '_other'; });
          if (!otherCont) {
            otherCont = { id: '_other', label: 'Other', tiles: [] };
            layout.containers.push(otherCont);
          }
          for (var t = 0; t < cont.tiles.length; t++) otherCont.tiles.push(cont.tiles[t]);
          layout.containers = layout.containers.filter(function(x) { return x.id !== cont.id; });
          saveLayout(layout);
          renderLayout();
          restoreCollapsed();
          restorePalettes();
          applySizes();
          setEditMode(editMode);
        }; })(c));
        header.appendChild(delBtn);
        section.appendChild(header);

        // Grid.
        var grid = document.createElement('div');
        grid.className = 'pulse-grid';
        grid.setAttribute('data-container-id', c.id);

        var hasTiles = false;
        for (var ti = 0; ti < c.tiles.length; ti++) {
          var el = tileEls[c.tiles[ti]];
          if (el) { grid.appendChild(el); hasTiles = true; }
        }

        if (!hasTiles) {
          var empty = document.createElement('div');
          empty.className = 'pulse-container__empty';
          empty.textContent = 'Drag widgets here';
          grid.appendChild(empty);
        }

        section.appendChild(grid);
        host.appendChild(section);
      }
    }

    renderLayout();

    // ── Edit mode toggle ─────────────────────────────────────────────
    var editMode = false;
    var editBtn = document.getElementById('${config.editToggleId}');
    var addContainerBtn = document.getElementById('${config.addContainerId}');

    function setEditMode(on) {
      editMode = on;
      document.body.classList.toggle('pulse-edit-mode', on);
      if (editBtn) editBtn.textContent = on ? '\\u2713 Done editing' : '\\u270E Edit layout';
      if (editBtn) editBtn.classList.toggle('btn--primary', on);
      if (editBtn) editBtn.classList.toggle('btn--ghost', !on);
      if (addContainerBtn) addContainerBtn.style.display = on ? '' : 'none';
      // Toggle draggable on all tiles.
      var allTiles = document.querySelectorAll('.pulse-tile[data-agent-id]');
      for (var i = 0; i < allTiles.length; i++) {
        allTiles[i].setAttribute('draggable', on ? 'true' : 'false');
        // Hide delete/palette buttons on protected tiles.
        if (isProtected(allTiles[i].getAttribute('data-agent-id'))) {
          var delBtns = allTiles[i].querySelectorAll('.pulse-tile__delete, .pulse-tile__palette-btn');
          for (var j = 0; j < delBtns.length; j++) {
            delBtns[j].style.display = on ? 'none' : '';
          }
        }
      }
    }

    if (editBtn) {
      editBtn.addEventListener('click', function() { setEditMode(!editMode); });
    }

    // ── Drag and drop ────────────────────────────────────────────────
    var draggedId = null;
    var draggedEl = null;

    document.addEventListener('dragstart', function(e) {
      if (!editMode) { e.preventDefault(); return; }
      var tile = e.target.closest ? e.target.closest('.pulse-tile[data-agent-id]') : null;
      if (!tile) return;
      draggedId = tile.getAttribute('data-agent-id');
      draggedEl = tile;
      tile.classList.add('pulse-tile--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId);
    });

    document.addEventListener('dragend', function() {
      if (draggedEl) draggedEl.classList.remove('pulse-tile--dragging');
      draggedId = null;
      draggedEl = null;
      // Remove all drop targets.
      var targets = document.querySelectorAll('.pulse-container--drop-target');
      for (var i = 0; i < targets.length; i++) targets[i].classList.remove('pulse-container--drop-target');
    });

    document.addEventListener('dragover', function(e) {
      var grid = e.target.closest ? e.target.closest('.pulse-grid') : null;
      if (!grid || !draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var container = grid.closest('.pulse-container');
      if (container) container.classList.add('pulse-container--drop-target');
    });

    document.addEventListener('dragleave', function(e) {
      var container = e.target.closest ? e.target.closest('.pulse-container') : null;
      if (container && !container.contains(e.relatedTarget)) {
        container.classList.remove('pulse-container--drop-target');
      }
    });

    document.addEventListener('drop', function(e) {
      var grid = e.target.closest ? e.target.closest('.pulse-grid') : null;
      if (!grid || !draggedId) return;
      e.preventDefault();

      var targetContainerId = grid.getAttribute('data-container-id');
      if (!targetContainerId) return;

      // Find drop position: which tile are we dropping before?
      var tiles = grid.querySelectorAll('.pulse-tile[data-agent-id]');
      var dropIndex = tiles.length; // default: end
      for (var i = 0; i < tiles.length; i++) {
        var rect = tiles[i].getBoundingClientRect();
        var midY = rect.top + rect.height / 2;
        var midX = rect.left + rect.width / 2;
        if (e.clientY < midY || (e.clientY < rect.bottom && e.clientX < midX)) {
          dropIndex = i;
          break;
        }
      }

      // Remove from source container in layout.
      for (var ci = 0; ci < layout.containers.length; ci++) {
        var idx = layout.containers[ci].tiles.indexOf(draggedId);
        if (idx !== -1) {
          layout.containers[ci].tiles.splice(idx, 1);
          break;
        }
      }

      // Insert into target container.
      var targetCont = layout.containers.find(function(c) { return c.id === targetContainerId; });
      if (targetCont) {
        // Adjust drop index if the dragged element was before the drop point in the same container.
        targetCont.tiles.splice(dropIndex, 0, draggedId);
      }

      saveLayout(layout);
      renderLayout();
      restoreCollapsed();
      restorePalettes();
      applySizes();
      setEditMode(editMode);
    });

    // ── Add container ────────────────────────────────────────────────
    var addBtn = document.getElementById('${config.addContainerId}');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var name = prompt('Group name:');
        if (!name || !name.trim()) return;
        var id = 'custom-' + Date.now();
        layout.containers.push({ id: id, label: name.trim(), tiles: [] });
        saveLayout(layout);
        renderLayout();
        restoreCollapsed();
        restorePalettes();
        applySizes();
        setEditMode(editMode);
      });
    }

    // ── Palette cycling ──────────────────────────────────────────────
    document.addEventListener('click', function(e) {
      var btn = e.target.closest ? e.target.closest('.pulse-tile__palette-btn') : null;
      if (!btn) return;
      var tileId = btn.getAttribute('data-tile-id');
      if (!tileId) return;
      if (isProtected(tileId)) return;
      var tile = document.querySelector('.pulse-tile[data-agent-id="' + tileId + '"]');
      if (!tile) return;

      var current = tile.getAttribute('data-palette') || 'default';
      var idx = PALETTES.indexOf(current);
      var next = PALETTES[(idx + 1) % PALETTES.length];

      if (next === 'default') {
        tile.removeAttribute('data-palette');
      } else {
        tile.setAttribute('data-palette', next);
      }

      var p = getPalettes();
      if (next === 'default') { delete p[tileId]; } else { p[tileId] = next; }
      savePalettes(p);
    });

    function restorePalettes() {
      var p = getPalettes();
      // Apply auto-palettes first, then manual overrides.
      var allT = document.querySelectorAll('.pulse-tile[data-agent-id]');
      for (var i = 0; i < allT.length; i++) {
        var id = allT[i].getAttribute('data-agent-id');
        var manual = p[id];
        if (manual && manual !== 'default') {
          allT[i].setAttribute('data-palette', manual);
        } else if (!manual) {
          // Use auto-palette from server-rendered attribute.
          var auto = allT[i].getAttribute('data-auto-palette');
          if (auto) allT[i].setAttribute('data-palette', auto);
        }
      }
    }

    // ── Tile resize via drag handle ─────────────────────────────────
    function getSizes() {
      try { return JSON.parse(localStorage.getItem(SIZES_KEY) || '{}'); } catch { return {}; }
    }
    function saveSizes(s) {
      try { localStorage.setItem(SIZES_KEY, JSON.stringify(s)); } catch {}
    }

    function applySizes() {
      var sizes = getSizes();
      var allT = document.querySelectorAll('.pulse-tile[data-agent-id]');
      for (var i = 0; i < allT.length; i++) {
        var id = allT[i].getAttribute('data-agent-id');
        var s = sizes[id];
        if (s) {
          allT[i].style.gridColumn = 'span ' + (s.cols || 1);
          allT[i].style.gridRow = 'span ' + (s.rows || 1);
          // Remove preset size classes — inline style takes over.
          allT[i].classList.remove('pulse-tile--2x1', 'pulse-tile--1x2', 'pulse-tile--2x2');
        }
      }
    }

    var resizing = null;

    document.addEventListener('mousedown', function(e) {
      if (!editMode) return;
      var handle = e.target.closest ? e.target.closest('.pulse-tile__resize-handle') : null;
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();

      var tile = handle.closest('.pulse-tile');
      if (!tile) return;

      var grid = tile.closest('.pulse-grid');
      if (!grid) return;

      var gridRect = grid.getBoundingClientRect();
      var gridStyle = window.getComputedStyle(grid);
      var gapStr = gridStyle.gap || gridStyle.gridGap || '16px';
      var gap = parseInt(gapStr) || 16;
      var cols = 4;
      var gridCellW = (gridRect.width - gap * (cols - 1)) / cols;
      var gridCellH = gridCellW * 0.6;

      var tileRect = tile.getBoundingClientRect();
      var currentCols = Math.round(tileRect.width / (gridCellW + gap)) || 1;
      var currentRows = Math.max(1, Math.round(tileRect.height / (gridCellH + gap)));

      tile.classList.add('pulse-tile--resizing');

      resizing = {
        tile: tile,
        agentId: tile.getAttribute('data-agent-id'),
        startX: e.clientX,
        startY: e.clientY,
        startCols: currentCols,
        startRows: currentRows,
        gridCellW: gridCellW,
        gridCellH: gridCellH,
        gap: gap
      };
    });

    document.addEventListener('mousemove', function(e) {
      if (!resizing) return;
      e.preventDefault();

      var dx = e.clientX - resizing.startX;
      var dy = e.clientY - resizing.startY;

      var newCols = Math.max(1, Math.min(4, resizing.startCols + Math.round(dx / (resizing.gridCellW + resizing.gap))));
      var newRows = Math.max(1, Math.min(4, resizing.startRows + Math.round(dy / (resizing.gridCellH + resizing.gap))));

      resizing.tile.style.gridColumn = 'span ' + newCols;
      resizing.tile.style.gridRow = 'span ' + newRows;
      resizing.newCols = newCols;
      resizing.newRows = newRows;
    });

    document.addEventListener('mouseup', function() {
      if (!resizing) return;

      resizing.tile.classList.remove('pulse-tile--resizing');
      resizing.tile.classList.remove('pulse-tile--2x1', 'pulse-tile--1x2', 'pulse-tile--2x2');

      var newCols = resizing.newCols || resizing.startCols;
      var newRows = resizing.newRows || resizing.startRows;

      var sizes = getSizes();
      if (newCols === 1 && newRows === 1) {
        delete sizes[resizing.agentId];
        resizing.tile.style.gridColumn = '';
        resizing.tile.style.gridRow = '';
      } else {
        sizes[resizing.agentId] = { cols: newCols, rows: newRows };
      }
      saveSizes(sizes);
      resizing = null;
    });

    applySizes();

    function restoreCollapsed() {
      try {
        var collapsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
        for (var id in collapsed) {
          var el = document.querySelector('.pulse-tile[data-agent-id="' + id + '"]');
          if (el) el.classList.add('pulse-tile--collapsed');
        }
      } catch {}
    }
    restoreCollapsed();
  })();
`;
}

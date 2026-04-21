/**
 * Pulse layout JS: containers, drag-and-drop, palette cycling, tile resize,
 * collapse/expand, and YouTube media embeds.
 *
 * Extracted from js.ts — each IIFE is independent. Inlined via layout.ts.
 */
export const PULSE_LAYOUT_JS = `
  // ── Pulse layout: containers, drag-and-drop, palette ────────────────
  (function () {
    var host = document.getElementById('pulse-containers');
    var dataEl = document.getElementById('pulse-tile-data');
    if (!host || !dataEl) return;

    var tileData = JSON.parse(dataEl.textContent || '{}');
    var allIds = tileData.allTileIds || [];
    var systemIds = tileData.systemTileIds || [];

    var LAYOUT_KEY = 'sua-pulse-layout';
    var PALETTE_KEY = 'sua-pulse-palettes';
    var PALETTES = ['default', 'dark', 'light', 'accent-teal', 'accent-red', 'accent-green'];

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
      layout = {
        containers: [
          { id: 'health', label: 'Health', tiles: systemIds.slice() },
          { id: 'agents', label: 'Agents', tiles: allIds.filter(function(id) { return systemIds.indexOf(id) === -1; }) }
        ]
      };
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
    var editBtn = document.getElementById('pulse-edit-toggle');
    var addContainerBtn = document.getElementById('pulse-add-container');

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
    var addBtn = document.getElementById('pulse-add-container');
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
    // Mousedown on the bottom-right handle, track mouse, snap to grid
    // columns (1-4) and rows (1-4), update inline style + localStorage.
    var SIZES_KEY = 'sua-pulse-sizes';
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

    var resizing = null; // { tile, startX, startY, startCols, startRows, gridCellW, gridCellH, gap }

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

      // Compute grid cell dimensions from the grid's actual layout.
      var gridRect = grid.getBoundingClientRect();
      var gridStyle = window.getComputedStyle(grid);
      var gapStr = gridStyle.gap || gridStyle.gridGap || '16px';
      var gap = parseInt(gapStr) || 16;
      var cols = 4; // fixed 4-column grid
      var gridCellW = (gridRect.width - gap * (cols - 1)) / cols;
      var gridCellH = gridCellW * 0.6; // approximate row height (aspect ratio)

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

      // Persist size override.
      var sizes = getSizes();
      if (newCols === 1 && newRows === 1) {
        delete sizes[resizing.agentId]; // back to default
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
      // Re-apply collapsed state after layout re-render.
      try {
        var collapsed = JSON.parse(localStorage.getItem('sua-pulse-collapsed') || '{}');
        for (var id in collapsed) {
          var el = document.querySelector('.pulse-tile[data-agent-id="' + id + '"]');
          if (el) el.classList.add('pulse-tile--collapsed');
        }
      } catch {}
    }
    restoreCollapsed();
  })();

  // ── Pulse tile collapse/expand ──────────────────────────────────────
  // Clicking the chevron or header title toggles the tile body.
  // Collapsed state persists in localStorage per agent id.
  (function () {
    var STORAGE_KEY = 'sua-pulse-collapsed';
    function getCollapsed() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
    }
    function setCollapsed(map) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
    }

    // Restore collapsed state on load.
    var collapsed = getCollapsed();
    var tiles = document.querySelectorAll('.pulse-tile');
    for (var i = 0; i < tiles.length; i++) {
      var btn = tiles[i].querySelector('.pulse-tile__collapse');
      if (btn) {
        var id = btn.getAttribute('data-tile-id');
        if (id && collapsed[id]) tiles[i].classList.add('pulse-tile--collapsed');
      }
    }

    // Toggle on click.
    document.addEventListener('click', function (e) {
      var target = e.target;
      // Check if click is on the collapse button or the header trigger area.
      var tileId = null;
      if (target.classList && target.classList.contains('pulse-tile__collapse')) {
        tileId = target.getAttribute('data-tile-id');
      } else if (target.closest && target.closest('[data-collapse-trigger]')) {
        tileId = target.closest('[data-collapse-trigger]').getAttribute('data-tile-id');
      }
      if (!tileId) return;

      // Find the parent tile.
      var tile = target.closest('.pulse-tile');
      if (!tile) return;

      tile.classList.toggle('pulse-tile--collapsed');
      var map = getCollapsed();
      if (tile.classList.contains('pulse-tile--collapsed')) {
        map[tileId] = true;
      } else {
        delete map[tileId];
      }
      setCollapsed(map);
    });
  })();

  // ── Pulse media: click-to-play YouTube embeds ───────────────────────
  // Click thumbnail to swap to iframe embed. If embed fails (video
  // disallows embedding), show a "blocked" message with link.
  (function () {
    document.addEventListener('click', function (e) {
      var el = e.target;
      while (el && !el.classList?.contains('pulse-media-yt')) el = el.parentElement;
      if (!el) return;
      var embedUrl = el.getAttribute('data-embed');
      var watchUrl = el.getAttribute('data-watch') || '';
      if (!embedUrl) return;
      e.preventDefault();

      // Save the original thumbnail HTML so we can restore on error.
      var originalHtml = el.innerHTML;
      el.style.cursor = 'default';

      var iframe = document.createElement('iframe');
      iframe.src = embedUrl;
      iframe.style.cssText = 'width:100%;aspect-ratio:16/9;border:0;border-radius:var(--radius-sm);';
      iframe.allow = 'accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture';
      iframe.allowFullscreen = true;

      // Detect embed failures. YouTube returns a 200 with an error page,
      // so we can't catch HTTP errors. Instead, set a timeout: if the
      // iframe loads the error page, the user can click "open externally".
      el.innerHTML = '';
      el.appendChild(iframe);

      // Add a small "can't play? open externally" link below.
      if (watchUrl) {
        var fallback = document.createElement('div');
        fallback.style.cssText = 'text-align:center;margin-top:var(--space-1);font-size:var(--font-size-xs);';
        fallback.innerHTML = '<a href="' + watchUrl + '" target="_blank" rel="noopener" style="color:var(--color-text-muted);">Not loading? Open on YouTube \\u2197</a>';
        el.parentElement.appendChild(fallback);
      }
    });
  })();
`;

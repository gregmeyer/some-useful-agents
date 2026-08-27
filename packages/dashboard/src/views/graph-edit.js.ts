/**
 * Wiring editor for the agent-detail DAG. Its own asset rather than grown
 * onto GRAPH_RENDER_JS: it loads only where editing is possible, and that
 * string is already long enough.
 *
 * Lives here, beside the other client scripts, so a test can import the exact
 * string we ship and run it against stub globals (see graph-edit.js.test.ts)
 * rather than re-implementing the logic and proving nothing.
 *
 * Reads the live cytoscape instance off `el.__cy`, which `renderDagViz` sets.
 * Ordering is safe because both are synchronous `<script src>` tags at parse
 * time and this one comes second.
 *
 * Edits `dependsOn` only. An edge source→target means "target dependsOn
 * source", matching the direction graph-render.js already draws.
 */
export const GRAPH_EDIT_JS = `
(function () {
  var el = document.getElementById('dag-canvas');
  var toolbar = document.querySelector('[data-dag-edit-toolbar]');
  if (!el || !toolbar) return;

  var form    = toolbar.querySelector('[data-dag-edit-form]');
  var hint    = toolbar.querySelector('[data-dag-edit-hint]');
  var input   = toolbar.querySelector('[data-dag-edit-wiring]');
  var toggle  = toolbar.querySelector('[data-dag-edit="toggle"]');
  var saveBtn = toolbar.querySelector('[data-dag-edit="save"]');
  var editing = false;
  var pending = null; // node id chosen as the source, click-click mode

  // The wiring we started from, so Save can stay disabled until something
  // actually changed and Cancel has something to restore to.
  var original = null;

  function cy() { return el.__cy; }

  function readWiring() {
    var c = cy(); if (!c) return {};
    var w = {};
    c.nodes().forEach(function (n) { w[n.id()] = []; });
    c.edges().forEach(function (e) {
      var t = e.target().id();
      if (!w[t]) w[t] = [];
      if (w[t].indexOf(e.source().id()) === -1) w[t].push(e.source().id());
    });
    Object.keys(w).forEach(function (k) { w[k].sort(); });
    return w;
  }

  function serialize(w) {
    var keys = Object.keys(w).sort();
    return JSON.stringify(keys.map(function (k) { return [k, w[k]]; }));
  }

  function refreshDirty() {
    if (!saveBtn) return;
    var changed = serialize(readWiring()) !== original;
    saveBtn.disabled = !changed;
    if (input) input.value = JSON.stringify(readWiring());
  }

  // Would adding source→target close a loop? Walk up from source: if we can
  // reach target, target is already upstream and the edge would make a cycle.
  // The server re-checks via the schema; this is just immediate feedback.
  function wouldCycle(sourceId, targetId) {
    if (sourceId === targetId) return true;
    var c = cy(), seen = {}, stack = [sourceId];
    while (stack.length) {
      var cur = stack.pop();
      if (cur === targetId) return true;
      var incoming = c.edges('[target = "' + cur + '"]');
      for (var i = 0; i < incoming.length; i++) {
        var s = incoming[i].source().id();
        if (!seen[s]) { seen[s] = true; stack.push(s); }
      }
    }
    return false;
  }

  function flash(message) {
    if (!hint) return;
    var prior = hint.getAttribute('data-base') || hint.textContent;
    hint.setAttribute('data-base', prior);
    hint.textContent = message;
    clearTimeout(hint.__t);
    hint.__t = setTimeout(function () { hint.textContent = prior; }, 2600);
  }

  // Self-pairs never arrive here: both gestures below drop them before
  // calling, and wouldCycle() would reject one anyway (a node is trivially
  // upstream of itself). No third guard.
  function connect(sourceId, targetId) {
    var c = cy();
    if (c.edges('[source = "' + sourceId + '"][target = "' + targetId + '"]').length) {
      flash(targetId + ' already depends on ' + sourceId + '.');
      return;
    }
    if (wouldCycle(sourceId, targetId)) {
      flash('That would create a loop (' + sourceId + ' is already downstream of ' + targetId + ').');
      return;
    }
    c.add({ data: { id: sourceId + '->' + targetId, source: sourceId, target: targetId } });
    refreshDirty();
  }

  // Highlight via cytoscape's overlay (what selection is designed for) set
  // inline — a class would need a rule registered in graph-render.js's
  // stylesheet, coupling the two files.
  function markSource(node) {
    node.style({ 'overlay-color': '#2563eb', 'overlay-padding': 6, 'overlay-opacity': 0.25 });
  }

  function clearPending() {
    var c = cy();
    if (pending && c) {
      var n = c.getElementById(pending);
      if (n && n.removeStyle) n.removeStyle('overlay-color overlay-padding overlay-opacity');
    }
    pending = null;
  }

  function setEditing(on) {
    var c = cy(); if (!c) return;
    editing = on;
    clearPending();
    el.classList.toggle('is-editing-wiring', on);
    if (toggle) {
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      toggle.textContent = on ? 'Editing wiring' : 'Edit wiring';
    }
    if (form) form.hidden = !on;
    if (hint) hint.hidden = !on;
    if (on) {
      original = serialize(readWiring());
      refreshDirty();
    }
  }

  // Drag-to-connect. Cytoscape keeps autoungrabify on (nodes stay laid out by
  // the layout engine, and node positions are not part of the agent schema),
  // so we track the gesture ourselves: press on a node, release on another.
  var dragFrom = null;

  function bind() {
    var c = cy(); if (!c || c.__editBound) return;
    c.__editBound = true;

    c.on('mousedown touchstart', 'node', function (evt) {
      if (!editing) return;
      dragFrom = evt.target.id();
    });

    c.on('mouseup touchend', 'node', function (evt) {
      if (!editing) return;
      var to = evt.target.id();
      if (dragFrom && dragFrom !== to) { connect(dragFrom, to); clearPending(); }
      dragFrom = null;
    });

    // Click-click fallback: drag is unavailable by keyboard and awkward on
    // touch, so tapping a source then a target does the same thing.
    c.on('tap', 'node', function (evt) {
      if (!editing) return;
      var id = evt.target.id();
      if (!pending) {
        pending = id;
        markSource(evt.target);
        flash('Now click the node that should depend on ' + id + '.');
        return;
      }
      if (pending !== id) connect(pending, id);
      clearPending();
    });

    c.on('tap', 'edge', function (evt) {
      if (!editing) return;
      var e = evt.target;
      flash('Removed ' + e.target().id() + ' → depends on ' + e.source().id() + '.');
      e.remove();
      refreshDirty();
    });

    // Tapping empty canvas abandons a half-made connection.
    c.on('tap', function (evt) { if (editing && evt.target === c) clearPending(); });
  }

  toolbar.addEventListener('click', function (evt) {
    var t = evt.target.closest ? evt.target.closest('[data-dag-edit]') : null;
    if (!t) return;
    var action = t.getAttribute('data-dag-edit');
    if (action === 'toggle') { bind(); setEditing(!editing); }
    if (action === 'cancel') {
      // Re-render from the untouched #dag-data payload. Clearing the signature
      // is what makes renderDagViz treat it as changed and rebuild.
      el.__dagSig = null;
      if (window.renderDagViz) window.renderDagViz();
      setEditing(false);
      bind();
    }
  });

  if (form) {
    form.addEventListener('submit', function () {
      if (input) input.value = JSON.stringify(readWiring());
    });
  }
})();
`;

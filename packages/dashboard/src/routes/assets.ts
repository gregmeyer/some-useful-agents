import { Router, type Request, type Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static-asset router. Serves:
 *
 *   1. /assets/cytoscape.min.js
 *      Resolved at startup by walking up from this module to find a
 *      node_modules/cytoscape/dist/cytoscape.min.js.
 *
 *   2. /assets/graph-render.js
 *      Tiny vanilla bootstrap that reads the server-rendered DAG JSON
 *      out of a `<script type="application/json">` tag and instantiates
 *      cytoscape against a `<div id="dag-canvas">`.
 *
 *   3. /assets/dashboard.css
 *      Concatenation of tokens.css, base.css, components.css, screens.css.
 *      The design-system foundation. Files live in src/assets/ and are
 *      copied to dist/assets/ by the build script.
 *
 * All are read once at startup and cached in memory with a
 * long-lived immutable Cache-Control.
 */

const require = createRequire(import.meta.url);

function resolveCytoscapePath(): string | undefined {
  // Try the conventional resolve first — picks up the hoisted install
  // if the workspace put cytoscape at the monorepo root.
  try {
    return require.resolve('cytoscape/dist/cytoscape.min.js');
  } catch { /* fall through */ }

  // Fallback: walk up from this file's directory looking for
  // node_modules/cytoscape/dist/cytoscape.min.js. Covers edge cases
  // where the workspace layout is unusual.
  const here = dirname(fileURLToPath(import.meta.url));
  let current = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(current, 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

const CYTOSCAPE_PATH = resolveCytoscapePath();
const CYTOSCAPE_JS = CYTOSCAPE_PATH ? readFileSync(CYTOSCAPE_PATH, 'utf-8') : '';

/**
 * Read and concatenate the dashboard CSS files at startup. Order matters:
 *   tokens (:root vars) → base (element defaults) → components → screens
 * Files are copied from src/assets/ to dist/assets/ by
 * scripts/copy-assets.mjs during the build.
 */
function loadDashboardCss(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Works from dist/routes/ (../assets) and from src/routes/ during tests
  // (../assets too). The copy-assets script keeps both in sync.
  const assetsDir = join(here, '..', 'assets');
  const order = ['tokens.css', 'base.css', 'components.css', 'screens.css'];
  return order
    .map((name) => {
      const path = join(assetsDir, name);
      if (!existsSync(path)) return `/* missing ${name} */`;
      return `/* ---- ${name} ---- */\n${readFileSync(path, 'utf-8')}`;
    })
    .join('\n');
}

const DASHBOARD_CSS = loadDashboardCss();

/**
 * The client-side bootstrap. Kept small and framework-free. Reads the
 * DAG description from the page, styles nodes by type + status, and
 * renders the graph into #dag-canvas.
 *
 * Style maps to the dashboard design tokens (tokens.css) — colors are
 * inlined as hex because Cytoscape can't read CSS variables, but they
 * track the same palette. When we change tokens.css, mirror here.
 *
 * Two visual states:
 *   - agent detail (no status data): node tinted by TYPE — soft fill,
 *     colored border + label.
 *   - run detail (status data per node): node tinted by STATUS — same
 *     pattern, status colors override type.
 */
const GRAPH_RENDER_JS = `
(function () {
  var el = document.getElementById('dag-canvas');
  var dataEl = document.getElementById('dag-data');
  if (!el || !dataEl || typeof window.cytoscape !== 'function') return;

  var payload;
  try { payload = JSON.parse(dataEl.textContent); } catch (e) { return; }

  // Status tints — mirror tokens.css (--color-*-soft for fill, --color-*
  // for border + text). Run-detail nodes use these.
  var statusStyle = {
    completed: { fill: '#dcfce7', border: '#15803d', text: '#166534' },
    failed:    { fill: '#fee2e2', border: '#b91c1c', text: '#991b1b' },
    running:   { fill: '#dbeafe', border: '#2563eb', text: '#1d4ed8' },
    pending:   { fill: '#fef3c7', border: '#b45309', text: '#92400e' },
    cancelled: { fill: '#fef3c7', border: '#b45309', text: '#92400e' },
    skipped:   { fill: '#f3f4f6', border: '#9ca3af', text: '#6b7280' },
  };
  // Type tints — agent-detail nodes (no status) use these. Both shell
  // and claude-code stay in the project's accent palette so the DAG
  // viz blends with the rest of the dashboard chrome.
  var typeStyle = {
    shell:         { fill: '#dcfce7', border: '#15803d', text: '#166534' },
    'claude-code': { fill: '#dbeafe', border: '#2563eb', text: '#1d4ed8' },
  };
  var defaultStyle = { fill: '#f9fafb', border: '#d1d5db', text: '#374151' };

  function pick(n, key) {
    var s = n.data('status');
    if (s && statusStyle[s]) return statusStyle[s][key];
    var t = n.data('type');
    if (t && typeStyle[t]) return typeStyle[t][key];
    return defaultStyle[key];
  }

  var cy = window.cytoscape({
    container: el,
    elements: payload.elements,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': function (n) { return pick(n, 'fill'); },
          'border-color':     function (n) { return pick(n, 'border'); },
          'color':            function (n) { return pick(n, 'text'); },
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
          'font-size': 10,
          'font-weight': 600,
          'width': 'label',
          'height': 26,
          'padding': '10px',
          'shape': 'round-rectangle',
          'border-width': 1,
          'corner-radius': '6px',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1.25,
          'line-color': '#d1d5db',
          'target-arrow-color': '#9ca3af',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          'curve-style': 'bezier',
        },
      },
    ],
    layout: {
      name: 'breadthfirst',
      directed: true,
      padding: 18,
      spacingFactor: 1.25,
      grid: false,
    },
    autoungrabify: true,
    userZoomingEnabled: false,
    userPanningEnabled: false,
    boxSelectionEnabled: false,
  });
  cy.fit(undefined, 18);

  // Click a node → open the node-action dialog with Edit + Replay buttons
  // and metadata pulled from the same Cytoscape payload. When no dialog
  // is present (older templates), fall back to hash-scrolling the per-node
  // card below via data-nav-base.
  var navBase = el.getAttribute('data-nav-base');
  var replayRunId = el.getAttribute('data-replay-run-id');
  var replayCommunity = el.getAttribute('data-replay-community') === '1';
  var editBase = el.getAttribute('data-edit-base');
  var dialog = document.getElementById('dag-node-dialog');
  var dialogSupported = dialog && typeof dialog.showModal === 'function';

  function fmtDuration(startedAt, completedAt) {
    if (!startedAt || !completedAt) return '—';
    var ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (!isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    return m + 'm' + s + 's';
  }

  function badge(kind, text) {
    var span = document.createElement('span');
    span.className = 'badge badge--' + kind;
    span.textContent = text;
    return span;
  }

  function openDialog(data) {
    if (!dialogSupported) return false;
    var idEl = dialog.querySelector('[data-node-id]');
    var typeEl = dialog.querySelector('[data-node-type]');
    var statusEl = dialog.querySelector('[data-node-status]');
    var depsEl = dialog.querySelector('[data-node-deps]');
    var durEl = dialog.querySelector('[data-node-duration]');
    var actionsEl = dialog.querySelector('[data-node-actions]');

    idEl.textContent = data.id;

    typeEl.innerHTML = '';
    if (data.type) {
      var tKind = data.type === 'shell' ? 'ok' : data.type === 'claude-code' ? 'info' : 'muted';
      typeEl.appendChild(badge(tKind, data.type));
    }

    statusEl.innerHTML = '';
    if (data.status) {
      var sKind = data.status === 'completed' ? 'ok'
        : data.status === 'failed' ? 'err'
        : data.status === 'running' || data.status === 'pending' ? 'info'
        : data.status === 'cancelled' ? 'warn'
        : 'muted';
      statusEl.appendChild(badge(sKind, data.status));
    }

    depsEl.textContent = data.dependsOn && data.dependsOn.length > 0 ? data.dependsOn : '—';
    durEl.textContent = fmtDuration(data.startedAt, data.completedAt);

    actionsEl.innerHTML = '';

    if (editBase) {
      var edit = document.createElement('a');
      edit.className = 'btn btn--sm';
      edit.textContent = 'Edit node';
      edit.href = editBase + '/' + encodeURIComponent(data.id) + '/edit';
      actionsEl.appendChild(edit);
    }

    if (replayRunId) {
      var form = document.createElement('form');
      form.method = 'POST';
      form.action = '/runs/' + encodeURIComponent(replayRunId) + '/replay';
      form.style.display = 'inline';

      var fromInput = document.createElement('input');
      fromInput.type = 'hidden';
      fromInput.name = 'fromNodeId';
      fromInput.value = data.id;
      form.appendChild(fromInput);

      if (replayCommunity) {
        var confirmInput = document.createElement('input');
        confirmInput.type = 'hidden';
        confirmInput.name = 'confirm_community_shell';
        confirmInput.value = 'yes';
        form.appendChild(confirmInput);
      }

      var btn = document.createElement('button');
      btn.type = 'submit';
      btn.className = 'btn btn--sm btn--primary';
      btn.textContent = replayCommunity ? 'Replay from here (community)' : 'Replay from here';
      btn.addEventListener('click', function (e) {
        var msg = 'Replay from "' + data.id + '"? Upstream outputs will be reused and this node plus downstream nodes will re-run.';
        if (replayCommunity) {
          msg += '\\n\\nThis agent contains community shell nodes. Continue?';
        }
        if (!window.confirm(msg)) e.preventDefault();
      });
      form.appendChild(btn);
      actionsEl.appendChild(form);
    }

    if (navBase) {
      var jump = document.createElement('a');
      jump.className = 'btn btn--sm btn--ghost';
      jump.textContent = 'Jump to details';
      jump.href = '#node-' + encodeURIComponent(data.id);
      jump.addEventListener('click', function () { dialog.close(); });
      actionsEl.appendChild(jump);
    }

    dialog.showModal();
    return true;
  }

  cy.on('tap', 'node', function (evt) {
    var n = evt.target;
    var data = {
      id: n.id(),
      label: n.data('label'),
      type: n.data('type'),
      status: n.data('status'),
      dependsOn: n.data('dependsOn') || '',
      startedAt: n.data('startedAt'),
      completedAt: n.data('completedAt'),
      exitCode: n.data('exitCode'),
    };
    if (!openDialog(data)) {
      // No dialog support (really old browser): fall back to hash-scroll.
      if (navBase) window.location.hash = 'node-' + encodeURIComponent(data.id);
    }
  });
})();
`;

export const assetsRouter: Router = Router();

assetsRouter.get('/assets/cytoscape.min.js', (_req: Request, res: Response) => {
  if (!CYTOSCAPE_JS) {
    res.status(500).type('text/plain').send('cytoscape not resolved at startup');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.type('application/javascript').send(CYTOSCAPE_JS);
});

assetsRouter.get('/assets/graph-render.js', (_req: Request, res: Response) => {
  // Short cache (5m) for our own bootstrap — during local dev we tweak
  // node styling and want changes visible on refresh without a hard
  // reload. Cytoscape itself stays on immutable since it's vendored.
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('application/javascript').send(GRAPH_RENDER_JS);
});

assetsRouter.get('/assets/dashboard.css', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('text/css').send(DASHBOARD_CSS);
});

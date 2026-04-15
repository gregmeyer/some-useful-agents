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
 * Visual choices are deliberately minimal — this is a monitoring
 * surface, not an editor. Nodes are circles with their id as the label,
 * edges are arrows pointing downstream. Colors match the CLI's
 * type vocabulary (shell = green, claude-code = magenta).
 */
const GRAPH_RENDER_JS = `
(function () {
  var el = document.getElementById('dag-canvas');
  var dataEl = document.getElementById('dag-data');
  if (!el || !dataEl || typeof window.cytoscape !== 'function') return;

  var payload;
  try { payload = JSON.parse(dataEl.textContent); } catch (e) { return; }

  var statusColor = {
    completed: '#15803d',
    failed: '#b91c1c',
    running: '#2563eb',
    pending: '#d97706',
    cancelled: '#b45309',
    skipped: '#6b7280',
  };
  var typeColor = {
    shell: '#15803d',
    'claude-code': '#a21caf',
  };

  var cy = window.cytoscape({
    container: el,
    elements: payload.elements,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': function (n) {
            var s = n.data('status');
            if (s && statusColor[s]) return statusColor[s];
            return typeColor[n.data('type')] || '#6b7280';
          },
          'label': 'data(label)',
          'color': '#fff',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': 11,
          'width': 80,
          'height': 40,
          'shape': 'round-rectangle',
          'border-width': 1,
          'border-color': '#111',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': '#6b7280',
          'target-arrow-color': '#6b7280',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
        },
      },
    ],
    layout: { name: 'breadthfirst', directed: true, padding: 10, spacingFactor: 1.1 },
  });

  // Click a node → anchor into the run-detail page on the same id.
  // No-op on /agents/:id (no target); clickable on /runs/:id via the
  // data-nav-base attribute the server rendered alongside the div.
  var navBase = el.getAttribute('data-nav-base');
  if (navBase) {
    cy.on('tap', 'node', function (evt) {
      var nodeId = evt.target.id();
      window.location.hash = 'node-' + encodeURIComponent(nodeId);
    });
  }
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
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.type('application/javascript').send(GRAPH_RENDER_JS);
});

assetsRouter.get('/assets/dashboard.css', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('text/css').send(DASHBOARD_CSS);
});

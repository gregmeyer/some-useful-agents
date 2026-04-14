/**
 * Inline CSS. Inlined in every response so there's no second round-trip.
 * Kept deliberately small — the dashboard is a monitoring surface, not a
 * design showcase. Matches the CLI's color/voice where it matters (status
 * colors, output frame style) and stays out of the way everywhere else.
 */
export const DASHBOARD_CSS = `
  :root {
    --bg: #fafafa;
    --fg: #111;
    --muted: #6b7280;
    --border: #e5e7eb;
    --accent: #0f766e;
    --ok: #15803d;
    --warn: #b45309;
    --err: #b91c1c;
    --info: #2563eb;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, sans-serif; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre { font-family: var(--mono); }
  pre { background: #f3f4f6; padding: 0.75rem 1rem; border-radius: 0.5rem; overflow: auto; }
  .topbar {
    display: flex; align-items: baseline; gap: 1.5rem;
    padding: 0.75rem 1.5rem; background: #fff; border-bottom: 1px solid var(--border);
  }
  .brand { font-weight: 700; font-size: 1.1rem; color: var(--fg); }
  .topbar nav { display: flex; gap: 1rem; }
  .topbar nav a { color: var(--muted); }
  .topbar nav a.active { color: var(--fg); font-weight: 600; }
  main { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
  h1 { margin-top: 0; font-size: 1.5rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; }
  tr:hover td { background: #f9fafb; }
  .badge {
    display: inline-block; padding: 0.1rem 0.5rem; border-radius: 0.5rem;
    font-size: 0.8rem; font-weight: 600; font-family: var(--mono);
  }
  .badge-ok { background: #dcfce7; color: var(--ok); }
  .badge-err { background: #fee2e2; color: var(--err); }
  .badge-warn { background: #fef3c7; color: var(--warn); }
  .badge-info { background: #dbeafe; color: var(--info); }
  .badge-muted { background: var(--border); color: var(--muted); }
  .dim { color: var(--muted); }
  .mono { font-family: var(--mono); font-size: 0.9em; }
  .filters {
    display: flex; gap: 0.75rem; align-items: end; flex-wrap: wrap;
    margin-bottom: 1rem; padding: 0.75rem; background: #fff;
    border: 1px solid var(--border); border-radius: 0.5rem;
  }
  .filters label { display: flex; flex-direction: column; font-size: 0.85rem; color: var(--muted); }
  .filters select, .filters input[type=text] {
    padding: 0.35rem 0.5rem; border: 1px solid var(--border);
    border-radius: 0.25rem; font-family: inherit; font-size: 0.9rem;
    min-width: 8rem;
  }
  .filters button {
    padding: 0.4rem 0.85rem; background: var(--accent); color: #fff;
    border: 0; border-radius: 0.25rem; cursor: pointer; font-size: 0.9rem;
  }
  .filters .reset { align-self: end; padding: 0.4rem 0.5rem; color: var(--muted); }
  .pager { display: flex; gap: 1rem; justify-content: space-between; margin-top: 1rem; color: var(--muted); font-size: 0.9rem; }
  .output-frame {
    margin-top: 0.5rem; padding: 0.75rem 1rem; background: #111; color: #f3f4f6;
    border-radius: 0.5rem; font-family: var(--mono); font-size: 0.9rem;
    white-space: pre-wrap; word-break: break-word;
  }
  .flash {
    padding: 0.75rem 1rem; border-radius: 0.5rem; margin-bottom: 1rem;
    border: 1px solid var(--border);
  }
  .flash-error { background: #fee2e2; border-color: #fecaca; color: var(--err); }
  .flash-info { background: #dbeafe; border-color: #bfdbfe; color: var(--info); }
  .run-now {
    display: inline-block; padding: 0.5rem 1rem; background: var(--accent);
    color: #fff; border: 0; border-radius: 0.25rem; cursor: pointer;
    font-size: 0.95rem; font-weight: 600;
  }
  .run-now-warn {
    background: var(--warn);
  }
  .kv { display: grid; grid-template-columns: 10rem 1fr; gap: 0.25rem 1rem; }
  .kv dt { color: var(--muted); font-size: 0.9rem; }
  .kv dd { margin: 0; }
  .modal-backdrop {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    align-items: center; justify-content: center; z-index: 10;
  }
  .modal-backdrop.open { display: flex; }
  .modal {
    background: #fff; padding: 1.5rem; border-radius: 0.5rem;
    max-width: 32rem; width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.2);
  }
  .modal h3 { margin-top: 0; color: var(--err); }
  .modal .command {
    background: #f3f4f6; padding: 0.5rem; border-radius: 0.25rem;
    font-family: var(--mono); font-size: 0.9rem; word-break: break-all;
  }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
  .community-banner {
    padding: 0.75rem 1rem; background: #fef2f2; border: 1px solid #fecaca;
    border-radius: 0.5rem; color: var(--err); margin-bottom: 1rem;
  }
`;

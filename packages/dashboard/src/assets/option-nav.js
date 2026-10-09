// Previous / Next on an option's page (views/notebook-option.ts): the server
// gives the order (those in the running, best first); this narrows it to the
// filters you chose on the notebook's grid, so Next skips what you filtered
// out, and adds the ← / → keys. The pure part (`stepThrough`) has no DOM.
import { applyFilters, filterChoices, liveSelection } from './option-filters.js';

/** Facts arrive formatted as the grid shows them. */
const asShown = (_key, v) => v;

/**
 * Where `id` sits among the options your filters keep, and the ones before
 * and after it there. An option your filters hide still steps to the nearest
 * kept ones on either side (in the full order).
 */
export function stepThrough(order, id, filters, selected) {
  const sel = liveSelection(selected ?? {}, filterChoices(order, filters, { fmt: asShown }));
  const kept = new Set(applyFilters(order, sel, asShown).map((o) => o.id));
  const i = order.findIndex((o) => o.id === id);
  let prev; let next;
  for (let j = i - 1; i >= 0 && j >= 0; j--) if (kept.has(order[j].id)) { prev = order[j]; break; }
  for (let j = i + 1; i >= 0 && j < order.length; j++) if (kept.has(order[j].id)) { next = order[j]; break; }
  const shown = order.filter((o) => kept.has(o.id));
  const pos = shown.findIndex((o) => o.id === id);
  return { prev, next, filtered: Object.keys(sel).length > 0, count: shown.length, ...(pos >= 0 ? { pos: pos + 1 } : {}) };
}

function init() {
  const nav = document.querySelector('[data-nbo-nav]');
  const data = nav?.querySelector('script[data-nbo-order]');
  if (!nav || !data) return;
  let d; try { d = JSON.parse(data.textContent || '{}'); } catch { return; }
  let selected = {};
  try { selected = JSON.parse(localStorage.getItem(`sua-option-filters:${d.filterKey}`) ?? '{}') || {}; } catch { /* none kept */ }
  const s = stepThrough(d.order ?? [], d.id, d.filters ?? [], selected);
  const set = (which, o) => {
    const a = nav.querySelector(`[data-nbo-${which}]`);
    if (!a) return;
    a.hidden = !o;
    if (!o) return;
    a.href = o.page;
    const label = a.querySelector('[data-nbo-name]');
    if (label) label.textContent = `#${o.rank} ${o.name}`;
    a.title = `${which === 'prev' ? 'Previous' : 'Next'}: ${o.name}`;
  };
  set('prev', s.prev);
  set('next', s.next);
  const pos = nav.querySelector('[data-nbo-pos]');
  if (pos && s.filtered) pos.textContent = s.pos ? `${s.pos} of ${s.count} filtered` : `filtered out · ${s.count} shown`;
  // "Open the next one" in the talk box goes where these buttons go.
  for (const [k, o] of [['next', s.next], ['prev', s.prev]]) {
    const input = document.querySelector(`[data-nbo-talk-${k}]`);
    if (input) input.value = o ? o.id : '';
  }
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable], [role="slider"], [data-a2ui-surface], .inbox-modal, dialog')) return;
    const o = e.key === 'ArrowLeft' ? s.prev : s.next;
    if (!o) return;
    e.preventDefault();
    window.location.assign(o.page);
  });
}

if (typeof document !== 'undefined') init();

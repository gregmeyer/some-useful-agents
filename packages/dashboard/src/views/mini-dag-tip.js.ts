/**
 * Hover explanations for mini-DAG nodes (see mini-dag.ts).
 *
 * Why this exists instead of the SVG's native `<title>`: native SVG tooltips
 * are unreliable in practice. They need the pointer to rest, they're
 * suppressed outright by an ancestor `role="img"`, and in dense card layouts
 * they frequently just never appear — which is exactly what happened here.
 * The dot showed `cursor: help` and no text, which is worse than no
 * affordance at all: it promises an explanation and doesn't deliver.
 *
 * So: keep the `<title>` in the markup as the no-JS fallback, and when JS is
 * available, MOVE that text into a styled tooltip we control. The titles are
 * removed on init so the browser can't double up with its own.
 *
 * Delegated from document so cards rendered later (or swapped in by a poll)
 * work without re-initialising.
 */
export const MINI_DAG_TIP_JS = `
  (function () {
    var hits = document.querySelectorAll('.mini-dag__hitarea');
    if (!hits.length) return;

    // Hoist each native <title> into data-tip, then drop it so the browser
    // doesn't render its own tooltip on top of ours.
    for (var i = 0; i < hits.length; i++) {
      var t = hits[i].querySelector('title');
      if (t) {
        hits[i].setAttribute('data-tip', t.textContent || '');
        t.parentNode.removeChild(t);
      }
    }

    var tip = null;
    var OFFSET = 14;

    function ensureTip() {
      if (tip) return tip;
      tip = document.createElement('div');
      tip.className = 'mini-dag-tip';
      tip.setAttribute('role', 'tooltip');
      tip.hidden = true;
      document.body.appendChild(tip);
      return tip;
    }

    function place(x, y) {
      var el = ensureTip();
      // Measure first, then clamp, so the tip never hangs off-screen on a
      // node near the right or bottom edge of a card.
      var w = el.offsetWidth, h = el.offsetHeight;
      var left = x + OFFSET;
      var top = y + OFFSET;
      if (left + w > window.innerWidth - 8) left = x - w - OFFSET;
      if (top + h > window.innerHeight - 8) top = y - h - OFFSET;
      el.style.left = Math.max(8, left) + 'px';
      el.style.top = Math.max(8, top) + 'px';
    }

    function show(target, x, y) {
      var text = target.getAttribute('data-tip');
      if (!text) return;
      var el = ensureTip();
      el.textContent = text;
      el.hidden = false;
      place(x, y);
    }

    function hide() {
      if (tip) tip.hidden = true;
    }

    document.addEventListener('mouseover', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.mini-dag__hitarea') : null;
      if (t) show(t, e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', function (e) {
      if (tip && !tip.hidden) place(e.clientX, e.clientY);
    });

    document.addEventListener('mouseout', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.mini-dag__hitarea') : null;
      if (t) hide();
    });

    // Scrolling away from the node leaves an orphaned tooltip otherwise.
    window.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  })();
`;

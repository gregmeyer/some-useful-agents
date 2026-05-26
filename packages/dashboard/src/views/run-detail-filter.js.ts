/**
 * Run detail node execution filter JS.
 * Search across node id + stdout/stderr text, filter by status.
 *
 * Inlined via layout.ts.
 */
export const RUN_DETAIL_FILTER_JS = `
  // ── Run detail node filter ─────────────────────────────────────────
  (function () {
    var searchInput = document.querySelector('.run-detail-nodes__search');
    var statusSelect = document.querySelector('.run-detail-nodes__status-filter');
    if (!searchInput && !statusSelect) return;

    function filterNodes() {
      var query = searchInput ? searchInput.value.toLowerCase() : '';
      var status = statusSelect ? statusSelect.value : '';
      var cards = document.querySelectorAll('.run-node[data-node-id]');

      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var nodeId = card.getAttribute('data-node-id') || '';
        var nodeStatus = card.getAttribute('data-node-status') || '';

        // Status filter.
        if (status && nodeStatus !== status) {
          card.style.display = 'none';
          continue;
        }

        // Text search: match against node id and card text content.
        if (query) {
          var text = nodeId.toLowerCase() + ' ' + (card.textContent || '').toLowerCase();
          if (text.indexOf(query) === -1) {
            card.style.display = 'none';
            continue;
          }
        }

        card.style.display = '';
      }
    }

    if (searchInput) searchInput.addEventListener('input', filterNodes);
    if (statusSelect) statusSelect.addEventListener('change', filterNodes);

    // The search/select controls live OUTSIDE the swapped node-cards region, so
    // these listeners survive a live poll. Expose the filter so the poll can
    // re-apply the active query/status to freshly-swapped cards.
    window.__suaApplyNodeFilter = filterNodes;

    // ── Sticky DAG release ────────────────────────────────────────────
    // The DAG/Result row is sticky at top:0 with max-height:60vh, and the
    // cards-header below it is sticky too (z-index 6). Without intervention
    // the DAG bar stays pinned and the cards-header sticky-pins UNDER it.
    // Fix: as the sentinel approaches the DAG bar's bottom edge, add
    // .dag-released so the DAG bar reverts to position:static and scrolls
    // away — handing the top of the viewport to the cards-header alone.
    var sentinel = document.querySelector('[data-dag-release-sentinel]');
    var dagBar = document.querySelector('.run-detail-grid--sticky');
    if (sentinel && dagBar) {
      // Cache the DAG bar's stuck height once. Reading it after releasing
      // would return the post-release (uncapped) value and cause hysteresis
      // flapping right around the release line.
      var dagH = Math.min(dagBar.offsetHeight, window.innerHeight * 0.6);
      var ticking = false;
      function check() {
        ticking = false;
        var rect = sentinel.getBoundingClientRect();
        // Release when the sentinel has risen to within 8px of the DAG bar's
        // bottom edge — i.e. overlap is about to start.
        var shouldRelease = rect.top < dagH + 8;
        if (shouldRelease) dagBar.classList.add('dag-released');
        else dagBar.classList.remove('dag-released');
      }
      function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(check);
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', function () {
        dagH = Math.min(dagBar.offsetHeight, window.innerHeight * 0.6);
        onScroll();
      }, { passive: true });
      check();
    }
  })();
`;

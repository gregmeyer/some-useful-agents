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
  })();
`;

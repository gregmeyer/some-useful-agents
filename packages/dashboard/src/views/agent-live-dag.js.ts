/**
 * The agent Overview's diagram while a run is in progress
 * (views/agent-detail/overview.ts): every 2 seconds, fetch the run's node
 * statuses (/agents/:id/live.json), redraw the canvas so the running step
 * pulses, and say which step is working. When the run ends, reload so
 * Latest result shows it.
 */
export const AGENT_LIVE_DAG_JS = `
(function () {
  var host = document.querySelector('[data-agent-live-run]');
  if (!host) return;
  var runId = host.getAttribute('data-agent-live-run');
  var agentId = host.getAttribute('data-agent-live-agent');
  var stepEl = host.querySelector('[data-agent-live-step]');
  var ticks = 0;
  function tick() {
    if (++ticks > 900) return; // half an hour; a reload picks it up again
    if (document.visibilityState !== 'visible') { setTimeout(tick, 2000); return; }
    fetch('/agents/' + encodeURIComponent(agentId) + '/live.json?run=' + encodeURIComponent(runId), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        if (d.status !== 'running' && d.status !== 'pending') { location.reload(); return; }
        var data = document.getElementById('dag-data');
        if (data && host.contains(data) && data.textContent !== d.dag) {
          data.textContent = d.dag;
          if (typeof window.renderDagViz === 'function') window.renderDagViz();
        }
        if (stepEl && d.step) stepEl.textContent = d.step;
        setTimeout(tick, 2000);
      })
      .catch(function () { setTimeout(tick, 4000); });
  }
  setTimeout(tick, 2000);
})();
`;

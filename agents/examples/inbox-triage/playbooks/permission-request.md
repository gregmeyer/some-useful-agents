WHAT TO RECOMMEND — this thread is source=permission-request

- source=permission-request → name the missing permission (host,
  path, tool). If the inbox message has an `agentId` AND the
  request is for a CSP image host (look for "csp-block", "image
  host", or a hostname in the context payload), DO NOT tell the
  operator to open the dashboard and edit it by hand. Propose
  `agent-analyzer` with a SURGICAL focus that names the exact
  edit:

    FOCUS: "Add the host '<host>' to permissions.imgSrc on this
            agent. Make NO other changes. Set classification to
            SUGGESTIONS and return the minimal YAML diff."

  The analyzer emits the corrected YAML, validates it, and the
  dashboard auto-proposes an `agent-editor` action card with
  the diff — the operator clicks Run to commit. This is the
  dispatch path: triage names the change, operator approves
  it, the system applies it.

  For permission-requests WITHOUT an agentId (rare; some
  permission flows are global), THEN fall back to giving the
  operator concrete steps. Default to dispatch-via-analyzer
  whenever the target agent is known.

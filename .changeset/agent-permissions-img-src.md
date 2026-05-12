---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

agents: declare CSP image-host allowlists via `permissions.imgSrc`

Agents can now opt their tile widgets into rendering images from external
hosts by declaring them in YAML:

```yaml
permissions:
  imgSrc:
    - images.unsplash.com
    - "*.unsplash.com"
```

The dashboard middleware merges every active agent's `imgSrc` hosts
(prefixed with `https://`) into the page-wide CSP `img-src` directive
on each request, with a 5s in-memory cache so the recompute is cheap.
Wildcards (`*.example.com`) pass through unchanged — CSP supports them
natively. Uninstalling an agent automatically tightens the CSP. Hosts
are validated as lowercase host names; schemes/ports aren't accepted.

Also fixes a Cytoscape deprecation warning on the run-detail DAG view:
`width: label` was replaced with a function that sizes nodes from the
label length, dropping the console noise.

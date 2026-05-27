/**
 * Static-analysis helper that finds external image hosts referenced by
 * an agent's spec. Used by AgentStore on create/upsert to backfill
 * `permissions.imgSrc` so a drafted agent's `<img src="…">` tags don't
 * silently break at runtime via CSP block.
 *
 * Scope:
 *   - Walks `agent.outputWidget.template` (the ai-template HTML body
 *     — where 99% of widget image URLs live). Anything `<img src="…">`
 *     pointing at a real HTTPS host gets its hostname extracted.
 *
 * Out of scope (handled at runtime by the inline-allow card):
 *   - DAG node outputs (only known after a run, not at spec time)
 *   - Markdown images that the LLM renders dynamically into a result
 *   - CSS `background-image: url(…)` inside templates (rare; can extend later)
 *
 * The CSP baseline already allows `img.youtube.com`, `i.vimeocdn.com`,
 * and `data:` URIs — those are filtered out so backfilled
 * `permissions.imgSrc` lists stay minimal. Host names are lowercased
 * and de-duplicated.
 */

/**
 * Hosts the dashboard CSP allows by default — must mirror `BASE_IMG_SRC`
 * in packages/dashboard/src/index.ts. Backfilling these would be noise.
 */
const BASELINE_IMG_HOSTS: ReadonlySet<string> = new Set([
  'img.youtube.com',
  'i.vimeocdn.com',
]);

// One regex per `<img>` tag in the template. The src attribute may use
// single or double quotes. We allow optional whitespace and any other
// attributes before `src=`. Hostname is captured up to the first `/`,
// `?`, `#`, `"`, `'`, or whitespace.
const IMG_TAG_RE = /<img\b[^>]*?\bsrc\s*=\s*["']https?:\/\/([^/"'?#\s]+)/gi;

// Hostname format check: lowercase letters, digits, hyphens, dots,
// optional leading `*.` for wildcard. Reject ports, anything weird.
// IP literals pass this regex (digits + dots match too); the IPv4
// guard below catches them separately.
const VALID_HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface ExtractImgHostsInput {
  outputWidget?: { template?: string } | undefined;
}

/**
 * Extract the external image-host hostnames referenced by an agent
 * spec's outputWidget template. Returns a sorted, de-duplicated array
 * of bare hostnames suitable for `permissions.imgSrc`.
 *
 * Excludes:
 *   - Hosts in BASELINE_IMG_HOSTS (already allowed by the dashboard CSP)
 *   - Empty / malformed hostnames
 *   - Anything that doesn't match the hostname regex (IPs, ports, etc.)
 */
export function extractImgHosts(spec: ExtractImgHostsInput): string[] {
  const template = spec.outputWidget?.template;
  if (!template || typeof template !== 'string') return [];
  const hosts = new Set<string>();
  // Reset regex state — the `g` flag makes the regex stateful across calls.
  IMG_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_TAG_RE.exec(template)) !== null) {
    const host = m[1].toLowerCase();
    if (!VALID_HOST_RE.test(host)) continue;
    if (IPV4_RE.test(host)) continue;
    if (BASELINE_IMG_HOSTS.has(host)) continue;
    hosts.add(host);
  }
  return Array.from(hosts).sort();
}

/**
 * Merge extracted hosts with an existing `permissions.imgSrc` list.
 * Preserves any hosts the drafter (or user) explicitly declared, even
 * wildcard subdomains that the static analyser wouldn't infer on its
 * own. Returns a new sorted, de-duplicated array.
 */
export function mergeImgSrcHosts(existing: string[] | undefined, extracted: string[]): string[] {
  const set = new Set<string>();
  for (const h of existing ?? []) {
    const lower = h.toLowerCase().trim();
    if (lower) set.add(lower);
  }
  for (const h of extracted) set.add(h);
  return Array.from(set).sort();
}

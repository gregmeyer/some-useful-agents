/**
 * Image-link verifier for build-planner output.
 *
 * The structural critic (`build-plan-critic.ts`) checks that every external
 * `<img src="https://HOST/...">` host hardcoded in an ai-template is declared
 * in `permissions.imgSrc` so the page CSP won't block it. That keeps the
 * allowlist honest — but a host being *allowed* says nothing about whether
 * the specific URL actually resolves.
 *
 * The failure this module exists for: a drafter LLM hand-writes image URLs
 * into a generated agent (e.g. a `pick-hero` shell node with a baked-in array
 * of Wikimedia portrait URLs) and hallucinates the path. The host is real and
 * allowlisted, so CSP passes and the critic is happy, but the URL 404s and the
 * widget renders a broken image. Observed in the wild: ~1/3 of the Wikimedia
 * URLs in a drafted "Marvel hero of the day" agent were dead links.
 *
 * Because these URLs are *literals in the generated agent definition* (not
 * runtime output), we can extract and HEAD-check them at build-eval time —
 * before the agent is ever committed — and feed the dead ones back to the
 * planner/drafter as critic-style feedback for a retry.
 *
 * Design choices:
 *  - Only HTTP(S) image URLs (by file extension) are checked. Data URIs and
 *    template placeholders (`{{outputs.image_url}}`) are skipped — the former
 *    can't 404, the latter is a runtime value we can't verify statically.
 *  - "Dead" means a *definitively gone* status (404 or 410). Network errors,
 *    timeouts, 401/403 (auth/hotlink), 429 (rate-limit) and 5xx are treated as
 *    inconclusive and NOT flagged — failing a build because the build host is
 *    offline or rate-limited would be worse than the broken image it prevents.
 *  - The per-URL checker is injected so the planner loop stays testable and
 *    offline by default; the dashboard wires `defaultCheckImageUrl`.
 */

import type { BuildPlan } from './build-plan-schema.js';

/** A URL the checker decided is gone, with the status that decided it. */
export interface DeadImageUrl {
  url: string;
  /** The HTTP status that marked it dead (404 or 410). */
  status: number;
}

export interface ImageCheckAgentResult {
  agentId: string;
  dead: DeadImageUrl[];
}

export interface ImageCheckResult {
  ok: boolean;
  /** One entry per newAgent with at least one dead link. Empty when ok. */
  perAgent: ImageCheckAgentResult[];
}

/** Signature of the injectable per-URL checker. Returns the HTTP status, or
 *  `null` when the request couldn't conclude (network error / timeout). */
export type CheckUrlFn = (url: string) => Promise<number | null>;

/** Statuses that mean "this resource is gone" — the only ones we flag. */
const DEAD_STATUSES = new Set([404, 410]);

/**
 * Match http(s) URLs that end in a known image extension (optionally followed
 * by a query string). The character class stops at whitespace and the
 * delimiters that commonly wrap a URL in YAML / shell / HTML (quotes, angle
 * brackets, backticks, backslashes, parens). URL-encoded segments like
 * `%28...%29` stay inside the match because `%` and digits aren't excluded.
 */
const IMG_URL_RE =
  /https?:\/\/[^\s"'`<>\\)]+\.(?:png|jpe?g|gif|svg|webp|bmp|avif|ico)(?:\?[^\s"'`<>\\)]*)?/gi;

/**
 * Extract unique image URLs from arbitrary text (a newAgent YAML document,
 * which embeds shell commands and ai-template HTML alike). Order-preserving
 * de-dup so feedback reads in the order a human would scan the file.
 */
export function extractImageUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(IMG_URL_RE)) {
    const url = m[0];
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Run a checker over a list of URLs with bounded concurrency and return the
 * subset that came back definitively dead (404/410). Inconclusive results
 * (null / other statuses) are dropped.
 */
export async function findDeadImageUrls(
  urls: string[],
  opts: { checkUrl: CheckUrlFn; concurrency?: number },
): Promise<DeadImageUrl[]> {
  const unique = Array.from(new Set(urls));
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const dead: DeadImageUrl[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (next < unique.length) {
      const url = unique[next++];
      let status: number | null = null;
      try {
        status = await opts.checkUrl(url);
      } catch {
        status = null; // a throwing checker is "inconclusive", not "dead"
      }
      if (status !== null && DEAD_STATUSES.has(status)) {
        dead.push({ url, status });
      }
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, unique.length) }, () => worker());
  await Promise.all(pool);
  // Restore input order (workers race; the result set shouldn't be arbitrary).
  const order = new Map(unique.map((u, i) => [u, i]));
  dead.sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0));
  return dead;
}

/**
 * Plan-level convenience: extract + check every newAgent's image URLs and
 * group the dead ones per agent. Used by the multi-agent PlannerLoopRunner.
 */
export async function checkPlanImageUrls(
  plan: BuildPlan,
  opts: { checkUrl: CheckUrlFn; concurrency?: number },
): Promise<ImageCheckResult> {
  // De-dup across agents so a URL shared by several drafts is fetched once,
  // then fan the verdict back out to each agent that referenced it.
  const perAgentUrls = plan.newAgents.map((a) => ({ agentId: a.id, urls: extractImageUrls(a.yaml) }));
  const allUrls = perAgentUrls.flatMap((a) => a.urls);
  const dead = await findDeadImageUrls(allUrls, opts);
  const deadByUrl = new Map(dead.map((d) => [d.url, d]));

  const perAgent: ImageCheckAgentResult[] = [];
  for (const { agentId, urls } of perAgentUrls) {
    const agentDead = urls.map((u) => deadByUrl.get(u)).filter((d): d is DeadImageUrl => d !== undefined);
    if (agentDead.length > 0) perAgent.push({ agentId, dead: agentDead });
  }
  return { ok: perAgent.length === 0, perAgent };
}

const DEAD_LINK_GUIDANCE =
  'These image URLs were hand-written into the agent and return 404/410 — the widget will render broken images. ' +
  'Replace each with a URL you can verify resolves, or drop the image field. ' +
  'Hand-written CDN paths (especially Wikimedia upload.wikimedia.org hash paths) are frequently wrong — ' +
  'prefer resolving images at runtime from a stable API/endpoint over baking literal asset URLs into the agent.';

/**
 * Format per-agent dead links as a critic-style feedback block (used by the
 * single-agent drafter loop in build-orchestrator).
 */
export function formatDeadImageFeedback(dead: DeadImageUrl[]): string {
  if (dead.length === 0) return '';
  const lines = dead.map((d) => `  - ${d.url} → HTTP ${d.status}`);
  return [
    'Critic feedback — dead image links in your previous draft (fix every item below):',
    ...lines,
    `  ${DEAD_LINK_GUIDANCE}`,
  ].join('\n');
}

/**
 * Format a plan-level image-check result as planner feedback. Mirrors
 * `formatCriticFeedback` / `formatSmokeFeedback` so the reflect step can hand
 * all three to the next compose invocation in one combined block.
 */
export function formatImageCheckFeedback(result: ImageCheckResult): string {
  if (result.ok) return '';
  const lines: string[] = [];
  lines.push('Image-link feedback on your previous plan (each URL below is a dead link — fix every item):');
  for (const a of result.perAgent) {
    lines.push(`- newAgent "${a.agentId}":`);
    for (const d of a.dead) lines.push(`  - ${d.url} → HTTP ${d.status}`);
  }
  lines.push(`  ${DEAD_LINK_GUIDANCE}`);
  return lines.join('\n');
}

/** User-Agent for link checks. Wikimedia (and others) reject requests with no
 *  descriptive UA, which would otherwise turn live images into false 403s. */
const IMG_CHECK_UA = 'some-useful-agents/image-link-check (+https://github.com/some-useful-agents)';

/**
 * Default per-URL checker: a HEAD request with a real User-Agent and a hard
 * timeout, falling back to a 1-byte ranged GET for hosts that reject HEAD
 * (405/501). Returns the HTTP status, or `null` on any network/timeout error
 * so the caller treats it as inconclusive rather than dead.
 */
export async function defaultCheckImageUrl(url: string, timeoutMs = 5000): Promise<number | null> {
  const attempt = async (method: 'HEAD' | 'GET'): Promise<number> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: method === 'GET'
          ? { 'User-Agent': IMG_CHECK_UA, Range: 'bytes=0-0' }
          : { 'User-Agent': IMG_CHECK_UA },
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const headStatus = await attempt('HEAD');
    if (headStatus === 405 || headStatus === 501) return await attempt('GET');
    return headStatus;
  } catch {
    return null;
  }
}

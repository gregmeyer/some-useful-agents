/**
 * Runtime image-host guard for ai-template output widgets.
 *
 * The page CSP only permits `<img>` loads from hosts an agent declares in
 * `permissions.imgSrc` (merged into the dashboard's `img-src` directive). The
 * build-time critic (`build-plan-critic.ts`) checks *hardcoded* template hosts,
 * but an ai-template usually pulls its image URL from a runtime output value
 * (`<img src="{{outputs.image_url}}">`). If that value resolves to a host the
 * agent never allowlisted, the browser silently blocks the image and the
 * run-detail auto-poll re-fires the violation on every refresh.
 *
 * This module computes — from the finished run's result + the agent's template —
 * exactly which image hosts the rendered widget will reference, and which of
 * those aren't allowlisted. The executor uses it to fail such a run with an
 * actionable error (rather than ship output that can't render safely); the
 * run-detail view uses it to suppress the broken widget and offer one-click
 * "Allow host".
 */

import { substitutePlaceholders } from './html-sanitizer.js';

/**
 * Extract the lowercased host of every `<img src="http(s)://...">` in rendered
 * HTML. Mirrors what the browser's CSP `img-src` check sees. Data URIs and
 * same-origin (relative) srcs are ignored — they don't hit an external host.
 */
export function extractImgTagHosts(html: string): string[] {
  const hosts = new Set<string>();
  const re = /<img\b[^>]*\bsrc\s*=\s*["']\s*(https?:\/\/[^"'\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      hosts.add(new URL(m[1]).hostname.toLowerCase());
    } catch {
      /* unparseable URL — skip */
    }
  }
  return [...hosts];
}

/** Does `host` match an allowlist entry, honouring `*.example.com` wildcards? */
function hostAllowed(host: string, allow: Set<string>): boolean {
  if (allow.has(host)) return true;
  for (const d of allow) {
    if (d.startsWith('*.') && host.endsWith(d.slice(1))) return true;
  }
  return false;
}

/**
 * Best-effort parse of an agent's output as a JSON object so `{{outputs.X}}`
 * placeholders resolve. Tolerates markdown fences and prose-wrapped JSON, the
 * same recovery the widget renderer applies. Returns `{}` when nothing parses.
 */
function parseOutputObject(output: string): Record<string, unknown> {
  const tryParse = (s: string): Record<string, unknown> | undefined => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(output.trim());
  if (direct) return direct;
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParse(fence[1].trim());
    if (fenced) return fenced;
  }
  const brace = output.match(/\{[\s\S]*\}/);
  if (brace) {
    const braced = tryParse(brace[0]);
    if (braced) return braced;
  }
  return {};
}

export interface WidgetImageHostInput {
  outputWidget?: { type?: string; template?: string };
  permissions?: { imgSrc?: string[] };
  result: string | null | undefined;
}

/**
 * Return the image hosts an ai-template widget would render that are NOT
 * covered by `permissions.imgSrc`. Empty when there's no ai-template widget,
 * no result, the template references no external images, or every referenced
 * host is already allowlisted.
 */
export function unallowedWidgetImageHosts(input: WidgetImageHostInput): string[] {
  const { outputWidget, permissions, result } = input;
  if (!outputWidget || outputWidget.type !== 'ai-template' || !outputWidget.template) return [];
  if (!result) return [];

  const outputs = parseOutputObject(result);
  const rendered = substitutePlaceholders(outputWidget.template, { outputs, result });
  const hosts = extractImgTagHosts(rendered);
  if (hosts.length === 0) return [];

  const allow = new Set((permissions?.imgSrc ?? []).map((h) => h.toLowerCase()));
  const bad: string[] = [];
  for (const h of hosts) {
    if (!hostAllowed(h, allow)) bad.push(h);
  }
  return bad;
}

/**
 * The run-error string for a run whose widget output references blocked image
 * hosts. Written to be actionable in the dashboard's Error block.
 */
export function formatBlockedImageError(hosts: string[]): string {
  const list = hosts.join(', ');
  const one = hosts.length === 1;
  return (
    `Widget output references image host${one ? '' : 's'} not allowed by the page security policy: ${list}. ` +
    `Add ${one ? 'it' : 'them'} to the agent's permissions.imgSrc (or click "Allow" on the run page), then re-run.`
  );
}

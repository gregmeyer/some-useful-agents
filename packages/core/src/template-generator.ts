/**
 * Template generators turn a natural-language prompt into HTML for the
 * `ai-template` output widget. Designed as a small, swappable interface
 * so we can ship Claude today and add Codex / Gemini / others later.
 *
 * Generators MUST return raw HTML (no markdown fences). The dashboard
 * sanitizes the response through the tag/attr allowlist before storage.
 */
import { spawn } from 'node:child_process';

export interface TemplateGenerationRequest {
  /** User-supplied description of the desired layout. */
  prompt: string;
  /** Optional sample of run output the template will render against. */
  sampleOutput?: string;
  /** Optional names of fields the agent emits (so the LLM uses them as placeholders). */
  fieldNames?: string[];
  /** Optional model override. Each generator interprets this. */
  model?: string;
  /** Abort signal (e.g. user closed the dialog). */
  signal?: AbortSignal;
}

export interface TemplateGenerator {
  /** Stable id used for selection (e.g. "claude", "codex", "gemini"). */
  id: string;
  /** Human-readable name shown in UI. */
  displayName: string;
  /** Returns raw HTML. */
  generate(req: TemplateGenerationRequest): Promise<string>;
}

const SYSTEM_PROMPT = [
  'You generate HTML templates for an agent run-output widget.',
  '',
  'Rules:',
  '- Return ONLY the HTML body. No <html>, no <head>, no <body> wrapper.',
  '- No markdown code fences. No prose. No comments outside HTML.',
  '- Use only these tags: div, span, p, h1-h6, ul, ol, li, dl, dt, dd,',
  '  table, thead, tbody, tr, th, td, code, pre, strong, em, br, hr,',
  '  small, section, article, header, footer, figure, figcaption, img,',
  '  svg, g, path, circle, rect, line, polyline, polygon, text, title.',
  '- Use only these attributes: class, style, id, role, aria-*, data-*,',
  '  href (https://), src (https:// or data:image/), alt, title, width,',
  '  height, viewBox, d, x, y, x1, y1, x2, y2, cx, cy, r, fill, stroke,',
  '  stroke-width, points, transform, colspan, rowspan.',
  '- Inline style is allowed but no <style>, <script>, <link>, <iframe>.',
  '- Substitute output values via {{outputs.NAME}} placeholders. Use',
  '  {{result}} for the raw run output if you need it.',
  '- Be visual: use color, hierarchy, sparklines as inline SVG, badges',
  '  as styled spans. Make it look polished, not like a wireframe.',
  '- Keep it self-contained — no external CSS, no fonts, no images',
  '  unless via data: URI.',
].join('\n');

function buildUserPrompt(req: TemplateGenerationRequest): string {
  const lines: string[] = [];
  lines.push('Layout request:');
  lines.push(req.prompt);
  if (req.fieldNames?.length) {
    lines.push('');
    lines.push(`Available output fields: ${req.fieldNames.join(', ')}`);
  }
  if (req.sampleOutput) {
    lines.push('');
    lines.push('Sample run output (for context — your template should work with values of similar shape):');
    lines.push('```');
    lines.push(req.sampleOutput.slice(0, 4000));
    lines.push('```');
  }
  lines.push('');
  lines.push('Return the HTML body now.');
  return lines.join('\n');
}

/**
 * Strip a trailing markdown fence + any preamble. LLMs sometimes ignore
 * the "no fence" instruction; this is the last line of defense before
 * the sanitizer (which would also drop unknown tags).
 */
function stripFences(raw: string): string {
  let s = raw.trim();
  // ```html\n...\n```
  const fenceMatch = s.match(/^```(?:html)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Single-line fenced
  if (s.startsWith('```') && s.endsWith('```')) {
    s = s.replace(/^```(?:html)?\s*/, '').replace(/```\s*$/, '');
  }
  return s.trim();
}

// ── Claude generator (default) ─────────────────────────────────────────

/**
 * Spawns `claude --print` to do a one-shot generation. Reuses the same
 * binary the executor uses, so authentication is automatic. Designed to
 * be replaced/parallelled by a Codex or Gemini implementation without
 * touching callers — the route picks an implementation by id.
 */
export const claudeTemplateGenerator: TemplateGenerator = {
  id: 'claude',
  displayName: 'Claude',
  async generate(req: TemplateGenerationRequest): Promise<string> {
    const args = [
      '--print',
      '--append-system-prompt', SYSTEM_PROMPT,
      buildUserPrompt(req),
    ];
    if (req.model) args.push('--model', req.model);

    return new Promise<string>((resolve, reject) => {
      const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`));
          return;
        }
        resolve(stripFences(stdout));
      });
      if (req.signal) {
        req.signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
          reject(new Error('Aborted by user.'));
        }, { once: true });
      }
    });
  },
};

// ── Registry ───────────────────────────────────────────────────────────

const REGISTRY = new Map<string, TemplateGenerator>([
  [claudeTemplateGenerator.id, claudeTemplateGenerator],
]);

export function registerTemplateGenerator(g: TemplateGenerator): void {
  REGISTRY.set(g.id, g);
}

export function getTemplateGenerator(id?: string): TemplateGenerator {
  if (id && REGISTRY.has(id)) return REGISTRY.get(id)!;
  return claudeTemplateGenerator;
}

export function listTemplateGenerators(): TemplateGenerator[] {
  return [...REGISTRY.values()];
}

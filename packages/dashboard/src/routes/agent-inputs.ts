import { Router, type Request, type Response } from 'express';
import type { AgentInputSpec, OutputWidgetSchema, OutputWidgetType, WidgetFieldType, NotifyConfig } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { mergeNewInput, parseEnumValues } from './agent-nodes.js';
import { renderOutputWidget } from '../views/output-widgets.js';
import { renderInteractiveWidget } from '../views/interactive-widget.js';
import { renderOutputWidgetPage, type OutputWidgetTab } from '../views/agent-output-widget.js';
import { synthPreviewOutput, type FieldType } from '../views/output-widget-help.js';
import { render } from '../views/html.js';
import { sanitizeHtml, getTemplateGenerator, agentV2Schema } from '@some-useful-agents/core';

export const agentInputsRouter: Router = Router();

const INPUT_TYPES = new Set(['string', 'number', 'boolean', 'enum']);

/**
 * Validate that a default value is compatible with the declared type.
 * Returns an error message or undefined if valid.
 */
function validateDefault(inputName: string, type: string, raw: string): string | undefined {
  if (raw === '') return undefined; // empty = no default, always ok
  switch (type) {
    case 'number': {
      if (raw.trim() === '' || !Number.isFinite(Number(raw))) {
        return `"${inputName}": default "${raw}" is not a valid number.`;
      }
      break;
    }
    case 'boolean': {
      const lower = raw.toLowerCase();
      if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lower)) {
        return `"${inputName}": default "${raw}" is not a valid boolean (use true/false).`;
      }
      break;
    }
  }
  return undefined;
}

/**
 * Coerce a raw default string to the appropriate JS type for storage.
 */
function coerceDefault(type: string, raw: string): string | number | boolean {
  if (type === 'number') return Number(raw);
  if (type === 'boolean') return ['true', '1', 'yes'].includes(raw.toLowerCase());
  return raw;
}

/**
 * POST /agents/:name/inputs/update — update types, defaults, and descriptions
 * on existing agent inputs, optionally add a new input. Validates that
 * default values match the declared type. Creates a new version.
 */
agentInputsRouter.post('/agents/:name/inputs/update', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updatedInputs: Record<string, AgentInputSpec> = {};
  const errors: string[] = [];

  // Update type, defaults, and descriptions on existing inputs.
  for (const [inputName, spec] of Object.entries(agent.inputs ?? {})) {
    const rawType = typeof body[`type_${inputName}`] === 'string'
      ? (body[`type_${inputName}`] as string).trim()
      : undefined;
    const newDefault = typeof body[`default_${inputName}`] === 'string'
      ? (body[`default_${inputName}`] as string).trim()
      : undefined;
    const newDescription = typeof body[`description_${inputName}`] === 'string'
      ? (body[`description_${inputName}`] as string).trim()
      : undefined;

    const updated: AgentInputSpec = { ...spec };

    // Type change
    if (rawType && INPUT_TYPES.has(rawType)) {
      updated.type = rawType as AgentInputSpec['type'];
    }

    // Default — validate against (possibly new) type
    if (newDefault !== undefined && newDefault !== '') {
      const err = validateDefault(inputName, updated.type, newDefault);
      if (err) {
        errors.push(err);
      } else {
        updated.default = coerceDefault(updated.type, newDefault);
      }
    } else if (newDefault === '') {
      delete updated.default;
    }

    if (newDescription !== undefined && newDescription !== '') {
      updated.description = newDescription;
    } else if (newDescription === '') {
      delete updated.description;
    }

    // Enum values: parse, require non-empty when type is enum, drop otherwise.
    const rawValues = typeof body[`values_${inputName}`] === 'string'
      ? (body[`values_${inputName}`] as string)
      : '';
    if (updated.type === 'enum') {
      const values = parseEnumValues(rawValues);
      if (values.length === 0) {
        errors.push(`"${inputName}": enum type requires at least one value (comma-separated).`);
      } else {
        (updated as AgentInputSpec & { values: string[] }).values = values;
      }
    } else {
      // Non-enum: drop any stale values array.
      delete (updated as AgentInputSpec & { values?: string[] }).values;
    }

    updatedInputs[inputName] = updated;
  }

  // Validate new input default too.
  const newInputName = typeof body.newInputName === 'string' ? body.newInputName.trim() : '';
  const newInputType = typeof body.newInputType === 'string' ? body.newInputType : 'string';
  const newInputDefault = typeof body.newInputDefault === 'string' ? body.newInputDefault.trim() : '';
  if (newInputName && newInputDefault) {
    const err = validateDefault(newInputName, newInputType, newInputDefault);
    if (err) errors.push(err);
  }
  // Enum requires values. If user picked enum but left values blank, surface it.
  if (newInputName && newInputType === 'enum') {
    const rawValues = typeof body.newInputValues === 'string' ? body.newInputValues : '';
    if (parseEnumValues(rawValues).length === 0) {
      errors.push(`"${newInputName}": enum type requires at least one value (comma-separated).`);
    }
  }

  if (errors.length > 0) {
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent(errors.join(' '))}#variables`);
    return;
  }

  // Merge new input (if provided).
  const merged = mergeNewInput(updatedInputs, body);

  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      { ...agent, inputs: merged && Object.keys(merged).length > 0 ? merged : undefined },
      'dashboard',
      'Updated input defaults via dashboard',
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent('Updated input defaults. New version created.')}#variables`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent(`Save failed: ${msg}`)}#variables`);
  }
});

// ── Output widget editor page ───────────────────────────────────────────

const OUTPUT_WIDGET_TABS = new Set<OutputWidgetTab>(['type', 'fields', 'interactive', 'preview']);

/**
 * GET /agents/:name/output-widget — focused page for the Output Widget
 * editor with sub-tabs (Type / Fields / Interactive / Preview). The
 * editor itself is reused unchanged — the page just adds tab nav.
 *
 * Replaces the inline editor that used to live on the Config tab.
 */
agentInputsRouter.get('/agents/:name/output-widget', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const tabRaw = typeof req.query.tab === 'string' ? req.query.tab : 'type';
  const activeTab: OutputWidgetTab = OUTPUT_WIDGET_TABS.has(tabRaw as OutputWidgetTab)
    ? (tabRaw as OutputWidgetTab)
    : 'type';
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flash = flashParam ? { kind: 'ok' as const, message: flashParam } : undefined;
  res.type('html').send(renderOutputWidgetPage({ agent, activeTab, flash }));
});

// ── Output widget update ────────────────────────────────────────────────

const VALID_WIDGET_TYPES = new Set<string>(['dashboard', 'key-value', 'diff-apply', 'raw', 'ai-template']);
const VALID_FIELD_TYPES = new Set<string>(['text', 'code', 'badge', 'action', 'metric', 'stat', 'preview']);

agentInputsRouter.post('/agents/:name/output-widget/update', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : 'save';

  // Remove widget.
  if (action === 'remove') {
    try {
      ctx.agentStore.createNewVersion(
        agent.id,
        { ...agent, outputWidget: undefined },
        'dashboard',
        'Removed output widget via dashboard',
      );
      // Widget gone — return to Config since there's nothing left to edit here.
      res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent('Output widget removed.')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/output-widget?flash=${encodeURIComponent(`Failed: ${msg}`)}`);
    }
    return;
  }

  // Save widget.
  const widgetType = typeof body.widgetType === 'string' ? body.widgetType : 'raw';
  if (!VALID_WIDGET_TYPES.has(widgetType)) {
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/output-widget?flash=${encodeURIComponent('Invalid widget type.')}`);
    return;
  }

  // Collect fields from the form (fieldName_0, fieldLabel_0, fieldType_0, etc.).
  const fields: NonNullable<OutputWidgetSchema['fields']> = [];
  for (let i = 0; i < 50; i++) {
    const fieldName = body[`fieldName_${i}`];
    const fieldLabel = body[`fieldLabel_${i}`];
    const fieldType = body[`fieldType_${i}`];
    if (typeof fieldName !== 'string' || !fieldName.trim()) continue;
    const ft = typeof fieldType === 'string' && VALID_FIELD_TYPES.has(fieldType) ? fieldType : 'text';
    fields.push({
      name: fieldName.trim(),
      ...(typeof fieldLabel === 'string' && fieldLabel.trim() ? { label: fieldLabel.trim() } : {}),
      type: ft as WidgetFieldType,
    });
  }

  // Interactive-mode fields. Checkbox values arrive as 'on' (or absent).
  // The runInputs checkbox group posts as either a string or an array.
  const interactive = body.widget_interactive === 'on' || body.widget_interactive === 'true';
  const rawRunInputs = body.widget_run_inputs;
  let runInputs: string[] | undefined;
  if (Array.isArray(rawRunInputs)) {
    runInputs = rawRunInputs.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } else if (typeof rawRunInputs === 'string' && rawRunInputs.length > 0) {
    runInputs = [rawRunInputs];
  }
  const askLabel = typeof body.widget_ask_label === 'string' && body.widget_ask_label.trim()
    ? body.widget_ask_label.trim() : undefined;
  const replayLabel = typeof body.widget_replay_label === 'string' && body.widget_replay_label.trim()
    ? body.widget_replay_label.trim() : undefined;

  let outputWidget: OutputWidgetSchema;
  if (widgetType === 'ai-template') {
    const rawTemplate = typeof body.template === 'string' ? body.template : '';
    const promptText = typeof body.prompt === 'string' ? body.prompt : '';
    const sanitized = sanitizeHtml(rawTemplate).trim();
    if (!sanitized) {
      res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/output-widget?tab=fields&flash=${encodeURIComponent('Generate or paste a template before saving.')}`);
      return;
    }
    outputWidget = {
      type: 'ai-template',
      template: sanitized,
      ...(promptText ? { prompt: promptText } : {}),
      ...(fields.length > 0 ? { fields } : {}),
      ...(interactive ? { interactive: true } : {}),
      ...(interactive && runInputs ? { runInputs } : {}),
      ...(interactive && askLabel ? { askLabel } : {}),
      ...(interactive && replayLabel ? { replayLabel } : {}),
    };
  } else {
    outputWidget = {
      type: widgetType as OutputWidgetType,
      fields,
      ...(interactive ? { interactive: true } : {}),
      ...(interactive && runInputs ? { runInputs } : {}),
      ...(interactive && askLabel ? { askLabel } : {}),
      ...(interactive && replayLabel ? { replayLabel } : {}),
    };
  }

  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      { ...agent, outputWidget },
      'dashboard',
      'Updated output widget via dashboard',
    );
    // Stay on the editor so iteration is one click, not a back-and-forth.
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/output-widget?flash=${encodeURIComponent('Output widget saved. New version created.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/output-widget?flash=${encodeURIComponent(`Save failed: ${msg}`)}`);
  }
});

// ── Output widget live preview ──────────────────────────────────────────

/**
 * POST /agents/:name/output-widget/preview — accepts the same form body
 * shape as /update, renders the widget with synthetic sample data, and
 * returns the inner HTML for the editor's preview card. No DB writes.
 * Returns 400 if widgetType is missing/invalid; never 500 on render
 * errors (falls back to an inline "Preview unavailable" note).
 */
agentInputsRouter.post('/agents/:name/output-widget/preview', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const widgetType = typeof body.widgetType === 'string' ? body.widgetType : '';
  if (!VALID_WIDGET_TYPES.has(widgetType)) {
    res.status(400).type('html').send('<span class="dim">Pick a widget type to preview.</span>');
    return;
  }

  // ai-template branch: render the live template, no fixture fields.
  if (widgetType === 'ai-template') {
    const rawTemplate = typeof body.template === 'string' ? body.template : '';
    if (!rawTemplate.trim()) {
      res.type('html').send('<span class="dim">Generate or paste a template to preview.</span>');
      return;
    }
    const sanitized = sanitizeHtml(rawTemplate).trim();
    if (!sanitized) {
      res.type('html').send('<span class="dim">Template is empty after sanitization. Avoid scripts/iframes; stick to layout HTML.</span>');
      return;
    }
    const schemaAi: OutputWidgetSchema = { type: 'ai-template', template: sanitized };
    // Build a synthetic run output that supplies values for every {{outputs.NAME}} placeholder.
    const placeholderNames = new Set<string>();
    const re = /\{\{\s*outputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    let pm: RegExpExecArray | null;
    while ((pm = re.exec(sanitized)) !== null) placeholderNames.add(pm[1]);
    const sample: Record<string, string> = {};
    for (const n of placeholderNames) sample[n] = `sample ${n}`;
    const fixtureAi = JSON.stringify(sample);
    try {
      const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const html = renderOutputWidget(schemaAi, fixtureAi, name);
      res.type('html').send(html ? render(html) : '<span class="dim">Preview unavailable.</span>');
    } catch {
      res.type('html').send('<span class="dim">Preview unavailable.</span>');
    }
    return;
  }

  const fields: NonNullable<OutputWidgetSchema['fields']> = [];
  for (let i = 0; i < 50; i++) {
    const fieldName = body[`fieldName_${i}`];
    const fieldLabel = body[`fieldLabel_${i}`];
    const fieldType = body[`fieldType_${i}`];
    if (typeof fieldName !== 'string' || !fieldName.trim()) continue;
    const ft = typeof fieldType === 'string' && VALID_FIELD_TYPES.has(fieldType) ? fieldType : 'text';
    fields.push({
      name: fieldName.trim(),
      ...(typeof fieldLabel === 'string' && fieldLabel.trim() ? { label: fieldLabel.trim() } : {}),
      type: ft as WidgetFieldType,
    });
  }

  // Interactive-mode preview: render the same `renderInteractiveWidget`
  // Pulse renders, in `staticPreview` mode (no inline state-machine JS,
  // so clicking the form doesn't accidentally submit a real run). This
  // is the only way the editor's labels + runInputs picker can be
  // visually verified before saving.
  const interactive = body.widget_interactive === 'on' || body.widget_interactive === 'true';
  if (interactive) {
    const ctx = getContext(req.app.locals);
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const agent = ctx.agentStore.getAgent(name);
    if (!agent) {
      res.type('html').send('<span class="dim">Agent not found.</span>');
      return;
    }
    const rawRunInputs = body.widget_run_inputs;
    let runInputs: string[] | undefined;
    if (Array.isArray(rawRunInputs)) {
      runInputs = rawRunInputs.filter((v): v is string => typeof v === 'string' && v.length > 0);
    } else if (typeof rawRunInputs === 'string' && rawRunInputs.length > 0) {
      runInputs = [rawRunInputs];
    }
    const askLabel = typeof body.widget_ask_label === 'string' && body.widget_ask_label.trim()
      ? body.widget_ask_label.trim() : undefined;
    const replayLabel = typeof body.widget_replay_label === 'string' && body.widget_replay_label.trim()
      ? body.widget_replay_label.trim() : undefined;
    const schema: OutputWidgetSchema = {
      type: widgetType as OutputWidgetType,
      fields,
      interactive: true,
      ...(runInputs ? { runInputs } : {}),
      ...(askLabel ? { askLabel } : {}),
      ...(replayLabel ? { replayLabel } : {}),
    };
    try {
      const html = renderInteractiveWidget({ agent, widget: schema, staticPreview: true });
      res.type('html').send(render(html));
    } catch {
      res.type('html').send('<span class="dim">Preview unavailable.</span>');
    }
    return;
  }

  if (fields.length === 0) {
    res.type('html').send('<span class="dim">Add a field to see the preview.</span>');
    return;
  }

  const schema: OutputWidgetSchema = { type: widgetType as OutputWidgetType, fields };
  const fixture = synthPreviewOutput(fields.map((f) => ({ name: f.name, type: f.type as FieldType })));

  try {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const html = renderOutputWidget(schema, fixture, name);
    if (!html) {
      res.type('html').send('<span class="dim">Preview unavailable for this widget type.</span>');
      return;
    }
    res.type('html').send(render(html));
  } catch {
    res.type('html').send('<span class="dim">Preview unavailable.</span>');
  }
});

// ── ai-template generator ──────────────────────────────────────────────

/**
 * POST /agents/:name/output-widget/generate — turns a natural-language
 * prompt into a sanitized HTML template via an LLM. Returns the
 * sanitized HTML as plain text (the editor stuffs it into a textarea).
 *
 * The generator is selected by `provider` (defaults to claude). A new
 * provider can be registered via core's `registerTemplateGenerator()`
 * without touching this route.
 */
agentInputsRouter.post('/agents/:name/output-widget/generate', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).type('text/plain').send('Agent not found');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const sampleOutput = typeof body.sampleOutput === 'string' ? body.sampleOutput : '';
  const provider = typeof body.provider === 'string' ? body.provider : undefined;

  if (!prompt) {
    res.status(400).type('text/plain').send('Prompt is required.');
    return;
  }

  // Field names declared on the agent's existing widget (so the LLM uses them).
  const declared = (agent.outputWidget?.fields ?? []).map((f) => f.name);
  const fieldNames = declared.length > 0 ? declared : undefined;

  try {
    // Wire express req.aborted to AbortController so Claude is killed when
    // the user clicks Cancel in the modal.
    const ac = new AbortController();
    req.on('close', () => { if (!res.writableEnded) ac.abort(); });
    const gen = getTemplateGenerator(provider);
    const raw = await gen.generate({ prompt, sampleOutput: sampleOutput || undefined, fieldNames, signal: ac.signal });
    const sanitized = sanitizeHtml(raw).trim();
    if (!sanitized) {
      res.status(502).type('text/plain').send('Generator returned empty output after sanitization. Try a different prompt.');
      return;
    }
    res.type('text/plain').send(sanitized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).type('text/plain').send(`Generation failed: ${msg}`);
  }
});

// ── Notify update ───────────────────────────────────────────────────────

/**
 * POST /agents/:name/notify/update — save or remove the notify block.
 * Body: action='save'|'remove', notify=<JSON string of notify config>.
 * Validates by re-parsing the agent through agentV2Schema (so any zod
 * issue surfaces as the same kind of error the YAML importer raises).
 */
agentInputsRouter.post('/agents/:name/notify/update', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : 'save';
  const flashBase = `/agents/${encodeURIComponent(agent.id)}/config`;

  if (action === 'remove') {
    try {
      ctx.agentStore.createNewVersion(
        agent.id,
        { ...agent, notify: undefined },
        'dashboard',
        'Removed notify via dashboard',
      );
      res.redirect(303, `${flashBase}?flash=${encodeURIComponent('Notify removed.')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(303, `${flashBase}?flash=${encodeURIComponent(`Failed: ${msg}`)}`);
    }
    return;
  }

  // Accept either `notify_json` (structured form, preferred) or the legacy
  // `notify` JSON blob (back-compat with old textarea + ad-hoc API calls).
  const fromForm = typeof body.notify_json === 'string' ? body.notify_json.trim() : '';
  const fromBlob = typeof body.notify === 'string' ? body.notify.trim() : '';
  const raw = fromForm || fromBlob;
  if (!raw) {
    res.redirect(303, `${flashBase}?flash=${encodeURIComponent('Notify body is empty.')}`);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `${flashBase}?flash=${encodeURIComponent(`Invalid JSON: ${msg}`)}`);
    return;
  }

  // Reuse the agent-v2 zod schema by re-validating the whole agent — this
  // ensures notify cross-checks (e.g. handler secrets must be declared)
  // run identically to the YAML import path.
  const candidate = { ...agent, notify: parsed };
  const result = agentV2Schema.safeParse(candidate);
  if (!result.success) {
    const summary = result.error.issues
      .filter((i) => i.path[0] === 'notify')
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ') || result.error.issues[0]?.message || 'Invalid notify config.';
    res.redirect(303, `${flashBase}?flash=${encodeURIComponent(`Validation failed: ${summary}`)}`);
    return;
  }

  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      { ...agent, notify: parsed as NotifyConfig },
      'dashboard',
      'Updated notify via dashboard',
    );
    res.redirect(303, `${flashBase}?flash=${encodeURIComponent('Notify saved. New version created.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `${flashBase}?flash=${encodeURIComponent(`Save failed: ${msg}`)}`);
  }
});

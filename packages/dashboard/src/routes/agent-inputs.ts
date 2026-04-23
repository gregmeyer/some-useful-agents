import { Router, type Request, type Response } from 'express';
import type { AgentInputSpec, OutputWidgetSchema, OutputWidgetType, WidgetFieldType } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { mergeNewInput } from './agent-nodes.js';

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

// ── Output widget update ────────────────────────────────────────────────

const VALID_WIDGET_TYPES = new Set<string>(['dashboard', 'key-value', 'diff-apply', 'raw']);
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
      res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent('Output widget removed.')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent(`Failed: ${msg}`)}`);
    }
    return;
  }

  // Save widget.
  const widgetType = typeof body.widgetType === 'string' ? body.widgetType : 'raw';
  if (!VALID_WIDGET_TYPES.has(widgetType)) {
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent('Invalid widget type.')}`);
    return;
  }

  // Collect fields from the form (fieldName_0, fieldLabel_0, fieldType_0, etc.).
  const fields: OutputWidgetSchema['fields'] = [];
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

  const outputWidget: OutputWidgetSchema = {
    type: widgetType as OutputWidgetType,
    fields,
  };

  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      { ...agent, outputWidget },
      'dashboard',
      'Updated output widget via dashboard',
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent('Output widget saved. New version created.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent(`Save failed: ${msg}`)}`);
  }
});

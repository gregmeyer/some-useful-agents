/**
 * The agent Settings page saves its batched sections (Model, When it runs,
 * Where it shows, Access) in one request. This module reads that form into the
 * next agent, says what changed in plain words, and validates it: the same
 * rules the old per-card routes applied, plus the agent schema as a whole.
 *
 * Inputs, webhook, notify and sub-agents keep their own editors and save on
 * their own; they are not read here.
 */
import {
  agentV2Schema,
  validateScheduleInterval,
  CronInvalidError,
  CronTooFrequentError,
  LLM_PROVIDERS,
  PROVIDERS,
  type Agent,
  type LlmProvider,
} from '@some-useful-agents/core';
import { cronToHuman } from '../views/components.js';

/** Settings-page sections, in page order. Ids double as anchors. */
export const SETTINGS_SECTIONS = [
  { id: 'inputs', label: 'Inputs' },
  { id: 'model', label: 'Model' },
  { id: 'when', label: 'When it runs' },
  { id: 'where', label: 'Where it shows' },
  { id: 'connect', label: 'Connections' },
  { id: 'access', label: 'Access' },
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id'];

/** The fields the batched form may carry. Only fields named in `_fields` are applied. */
export const SETTINGS_FIELDS = [
  'provider', 'model', 'schedule', 'runOn', 'pulseVisible', 'dashboardVisible', 'mcp', 'inboxRunnable', 'imgSrc',
] as const;
type SettingsField = typeof SETTINGS_FIELDS[number];

/** Fields stored on the agent row rather than in its versioned definition. */
const META_FIELDS: ReadonlySet<SettingsField> = new Set(['schedule', 'pulseVisible', 'dashboardVisible', 'mcp']);

export interface SettingsChange {
  field: SettingsField;
  section: SettingsSection;
  what: string;
  before: string;
  after: string;
}

export interface SettingsRead {
  next: Agent;
  changes: SettingsChange[];
  errors: string[];
  /** True when a change touches the versioned definition (saving makes a new version). */
  versioned: boolean;
}

// CSP host syntax; must match `permissions.imgSrc` in agent-v2-schema.ts.
const IMG_SRC_HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** Split a pasted host list, strip schemes / paths / ports, dedupe. */
export function parseImgHosts(raw: string): { hosts: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const hosts: string[] = [];
  const invalid: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    if (!piece) continue;
    const h = piece.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!h || seen.has(h)) continue;
    seen.add(h);
    if (IMG_SRC_HOST_RE.test(h)) hosts.push(h); else invalid.push(h);
  }
  return { hosts, invalid };
}

export function modelLabel(provider: string | undefined, model: string | undefined): string {
  const p = provider ? (PROVIDERS[provider as LlmProvider]?.displayName ?? provider) : 'Default provider';
  return `${p} · ${model || 'its default model'}`;
}

export function whenLabel(schedule: string | undefined): string {
  if (!schedule) return 'Only when asked';
  const human = cronToHuman(schedule);
  return human.charAt(0).toUpperCase() + human.slice(1);
}

export function runOnLabel(runOn: string | undefined): string {
  if (runOn === 'local') return 'In the dashboard';
  if (runOn === 'temporal') return 'Durably (survives restarts)';
  return 'Default';
}

const onOff = (v: boolean): string => (v ? 'on' : 'off');
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? String(v[v.length - 1] ?? '').trim() : '');
const checked = (v: unknown): boolean => {
  const s = Array.isArray(v) ? v[v.length - 1] : v;
  return s === '1' || s === 'on' || s === 'true' || s === true;
};

/** Read the batched Settings form against `agent`. Nothing is saved. */
export function readSettingsForm(agent: Agent, body: Record<string, unknown>): SettingsRead {
  const fields = new Set(str(body._fields).split(',').map((f) => f.trim()).filter((f): f is SettingsField => (SETTINGS_FIELDS as readonly string[]).includes(f)));
  const next: Agent = { ...agent };
  const changes: SettingsChange[] = [];
  const errors: string[] = [];
  const add = (field: SettingsField, section: SettingsSection, what: string, before: string, after: string) => {
    if (before !== after) changes.push({ field, section, what, before, after });
  };

  // Model: provider + model change together and read as one line.
  if (fields.has('provider') || fields.has('model')) {
    const provider = fields.has('provider') ? str(body.provider) : (agent.provider ?? '');
    const model = fields.has('model') ? str(body.model) : (agent.model ?? '');
    if (provider && !(LLM_PROVIDERS as readonly string[]).includes(provider)) {
      errors.push(`Unknown provider "${provider}". Pick one of: ${LLM_PROVIDERS.join(', ')}.`);
    } else {
      next.provider = (provider || undefined) as LlmProvider | undefined;
      next.model = model || undefined;
      if ((agent.provider ?? '') !== (next.provider ?? '') || (agent.model ?? '') !== (next.model ?? '')) {
        changes.push({ field: 'provider', section: 'model', what: 'Model', before: modelLabel(agent.provider, agent.model), after: modelLabel(next.provider, next.model) });
      }
    }
  }

  if (fields.has('schedule')) {
    const raw = str(body.schedule);
    if (raw) {
      try {
        validateScheduleInterval(raw, { allowHighFrequency: agent.allowHighFrequency });
        next.schedule = raw;
      } catch (err) {
        errors.push(err instanceof CronInvalidError
          ? `"${raw}" isn't a schedule sua understands. Use five fields (minute hour day month weekday), e.g. 0 9 * * 1-5.`
          : err instanceof CronTooFrequentError
            ? `"${raw}" runs more than once a minute. That needs allowHighFrequency: true in the agent's YAML.`
            : (err instanceof Error ? err.message : String(err)));
      }
    } else {
      next.schedule = undefined;
    }
    if ((agent.schedule ?? '') !== (next.schedule ?? '')) {
      changes.push({ field: 'schedule', section: 'when', what: 'When it runs', before: whenLabel(agent.schedule), after: whenLabel(next.schedule) });
    }
  }

  if (fields.has('runOn')) {
    const raw = str(body.runOn);
    if (raw && raw !== 'local' && raw !== 'temporal') errors.push(`Unknown backend "${raw}".`);
    else {
      next.runOn = (raw || undefined) as Agent['runOn'];
      add('runOn', 'when', 'Runs', runOnLabel(agent.runOn), runOnLabel(next.runOn));
    }
  }

  if (fields.has('pulseVisible')) {
    next.pulseVisible = checked(body.pulseVisible);
    add('pulseVisible', 'where', 'Show on Pulse', onOff(agent.pulseVisible !== false), onOff(next.pulseVisible));
  }
  if (fields.has('dashboardVisible')) {
    next.dashboardVisible = checked(body.dashboardVisible);
    add('dashboardVisible', 'where', 'Show in the agents list', onOff(agent.dashboardVisible !== false), onOff(next.dashboardVisible));
  }
  if (fields.has('mcp')) {
    next.mcp = checked(body.mcp);
    add('mcp', 'where', 'Let AI apps call it', onOff(!!agent.mcp), onOff(next.mcp));
  }

  // Access: both live under `permissions`, which disappears when empty.
  if (fields.has('inboxRunnable') || fields.has('imgSrc')) {
    const perms: NonNullable<Agent['permissions']> = { ...(agent.permissions ?? {}) };
    if (fields.has('inboxRunnable')) {
      if (checked(body.inboxRunnable)) perms.inboxRunnable = true; else delete perms.inboxRunnable;
      add('inboxRunnable', 'access', 'sua can run it from a conversation', onOff(!!agent.permissions?.inboxRunnable), onOff(!!perms.inboxRunnable));
    }
    if (fields.has('imgSrc')) {
      const { hosts, invalid } = parseImgHosts(str(body.imgSrc));
      if (invalid.length > 0) {
        errors.push(`Not a host name: ${invalid.join(', ')}. Use names like images.unsplash.com or *.unsplash.com.`);
      } else {
        if (hosts.length > 0) perms.imgSrc = hosts; else delete perms.imgSrc;
        const before = (agent.permissions?.imgSrc ?? []).slice().sort().join(', ');
        const after = hosts.slice().sort().join(', ');
        add('imgSrc', 'access', 'Images from', before || 'none', after || 'none');
      }
    }
    next.permissions = Object.keys(perms).length > 0 ? perms : undefined;
  }

  if (errors.length === 0 && changes.length > 0) {
    const parsed = agentV2Schema.safeParse(next);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 3)) errors.push(`${issue.path.join('.') || 'agent'}: ${issue.message}`);
    }
  }

  return { next, changes, errors, versioned: changes.some((c) => !META_FIELDS.has(c.field)) };
}

/** The row-level part of a save: what `updateAgentMeta` writes. */
export function settingsMetaPatch(read: SettingsRead): Partial<Pick<Agent, 'schedule' | 'mcp' | 'pulseVisible' | 'dashboardVisible'>> {
  const patch: Partial<Pick<Agent, 'schedule' | 'mcp' | 'pulseVisible' | 'dashboardVisible'>> = {};
  for (const c of read.changes) {
    if (c.field === 'schedule') patch.schedule = read.next.schedule;
    if (c.field === 'mcp') patch.mcp = read.next.mcp;
    if (c.field === 'pulseVisible') patch.pulseVisible = read.next.pulseVisible;
    if (c.field === 'dashboardVisible') patch.dashboardVisible = read.next.dashboardVisible;
  }
  return patch;
}

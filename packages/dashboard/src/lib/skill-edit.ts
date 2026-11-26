/**
 * Writing and changing skills in the dashboard (docs/skills.md): the list
 * with what each is and who uses it, a pasted SKILL.md read into its parts,
 * and the 16 KB an agent's skills may add up to, checked before anything is
 * saved so no agent is left unable to run.
 */
import {
  loadSkills, SkillStore, buildSkillsPreamble, skillProblem, MAX_SKILL_BYTES, MAX_SKILLS_PREAMBLE_BYTES,
  type Agent, type LoadSkillsResult, type Skill,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export function skillStore(ctx: Ctx): SkillStore | undefined {
  try { return SkillStore.fromHandle(ctx.runStore.databaseHandle()); } catch { return undefined; }
}

/** What a skill is here: shipped with sua, yours, or your copy of a shipped one. */
export type SkillOrigin = 'shipped' | 'yours' | 'your-copy';

export interface SkillRow {
  skill: Skill;
  origin: SkillOrigin;
  bytes: number;
  usedBy: Array<{ id: string; name: string }>;
}

export function skillBytes(body: string): number {
  return Buffer.byteLength(body.trim(), 'utf8');
}

/** "1.2 KB" */
export function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export { MAX_SKILL_BYTES, MAX_SKILLS_PREAMBLE_BYTES };

export function allSkills(ctx: Ctx): { loaded: LoadSkillsResult; shipped: LoadSkillsResult; rows: SkillRow[] } {
  const store = skillStore(ctx);
  const shipped = loadSkills(undefined);
  const loaded = loadSkills(store);
  const agents = safeAgents(ctx);
  const rows = [...loaded.byName.values()].sort((a, b) => a.name.localeCompare(b.name)).map((skill): SkillRow => ({
    skill,
    origin: skill.source !== 'local' ? 'shipped' : shipped.byName.has(skill.name) ? 'your-copy' : 'yours',
    bytes: skillBytes(skill.body),
    usedBy: agents.filter((a) => a.skills?.includes(skill.name)).map((a) => ({ id: a.id, name: a.name })),
  }));
  return { loaded, shipped, rows };
}

export function safeAgents(ctx: Ctx): Agent[] {
  try { return ctx.agentStore.listAgents(); } catch { return []; }
}

/**
 * A pasted SKILL.md (`---` name/description `---` then the text) read into
 * its parts; text with no frontmatter is just the text.
 */
export function readPastedSkill(raw: string): { name?: string; description?: string; body: string } {
  const text = raw.replace(/\r\n/g, '\n').trim();
  const unquote = (v: string) => v.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/\s+/g, ' ').trim();
  const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (fm) {
    const out: { name?: string; description?: string; body: string } = { body: fm[2].trim() };
    for (const line of fm[1].split('\n')) {
      const m = /^(name|description)\s*:\s*(.+)$/.exec(line);
      if (m) out[m[1] as 'name' | 'description'] = unquote(m[2]);
    }
    return out;
  }
  // As a skill page shows it when copied: "Metadata / name / <name> / description / <description>", then the text.
  const shown = /^(?:Metadata\s*\n)?name\s*\n([a-z0-9-]+)\s*\ndescription\s*\n([^\n]+)\n([\s\S]*)$/.exec(text);
  if (shown) return { name: shown[1], description: unquote(shown[2]), body: shown[3].trim() };
  return { body: text };
}

/** A skill in the SKILL.md shape, for copying out. */
export function skillMarkdown(s: Pick<Skill, 'name' | 'description' | 'body'>): string {
  return `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.body.trim()}\n`;
}

/**
 * Why saving this text would break an agent that uses the skill (its skills
 * would go over 16 KB together), or undefined.
 */
export function overAgentLimit(ctx: Ctx, loaded: LoadSkillsResult, next: Pick<Skill, 'name' | 'description' | 'body'>, extraAgent?: Agent): string | undefined {
  const byName = new Map(loaded.byName);
  byName.set(next.name, { ...(byName.get(next.name) ?? { file: '' }), ...next });
  const trial: LoadSkillsResult = { byName, problems: [] };
  const users = safeAgents(ctx).filter((a) => a.skills?.includes(next.name));
  if (extraAgent && !users.some((a) => a.id === extraAgent.id)) users.push({ ...extraAgent, skills: [...(extraAgent.skills ?? []), next.name] });
  for (const a of users) {
    try { buildSkillsPreamble(a.skills ?? [], trial); } catch {
      return `${a.id}'s skills would be over ${String(MAX_SKILLS_PREAMBLE_BYTES / 1024)} KB together. Make it shorter, or take it off ${a.id} first`;
    }
  }
  return undefined;
}

/** The skills one agent lists, and how much they add up to. */
export function agentSkillsBytes(loaded: LoadSkillsResult, names: readonly string[]): number {
  return [...new Set(names)].reduce((n, name) => n + skillBytes(loaded.byName.get(name)?.body ?? ''), 0);
}

export interface SkillFormValues { name: string; description: string; body: string }

/** The form's values, cleaned, and what's wrong with them. A pasted SKILL.md fills what's blank. */
export function skillFromForm(body: Record<string, unknown>, fixedName?: string): { values: SkillFormValues; problem?: string } {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const pasted = readPastedSkill(str('body'));
  const values: SkillFormValues = {
    name: (fixedName ?? (str('name').trim() || pasted.name || '')).trim(),
    description: (str('description').trim() || pasted.description || '').replace(/\s+/g, ' ').trim(),
    body: pasted.body,
  };
  const problem = skillProblem(values.name, values.description, values.body);
  return { values, ...(problem ? { problem: `It can't be saved: ${problem}.` } : {}) };
}

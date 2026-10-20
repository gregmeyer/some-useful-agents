/**
 * Skills: know-how several agents share, kept in one place (docs/skills.md).
 *
 * A skill is `skills/<name>/SKILL.md` in the examples tree (frontmatter with
 * `name` and `description`, then Markdown). An agent lists the ones it uses
 * in `skills:`, and their text goes into the run's preamble, like behaviors
 * (behaviors say how to act; skills say how a kind of work is done). Before
 * skills, the same rule was pasted into each agent's prompt and the copies
 * drifted apart (the builder knew web-search-links, the analyzer didn't).
 *
 * Shipped skills are found the way example agents are (example-loader.ts):
 * the repo copy first, then the bundled one, so an npm install has them too.
 * Skills the builder or analyzer proposed, once approved, are saved in the
 * run database with versions (SkillStore); a saved one with a shipped name is
 * your copy, and wins over the shipped file.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { splitFrontmatter } from './behaviors/frontmatter.js';
import { exampleSearchDirs } from './example-loader.js';

/** Where skills live inside the examples tree. */
export const SKILLS_DIR = 'skills';
export const SKILL_FILE = 'SKILL.md';
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** One skill's body. Know-how, not a manual: past this it's split or cut. */
export const MAX_SKILL_BYTES = 6 * 1024;
/** Every skill a run uses, together. */
export const MAX_SKILLS_PREAMBLE_BYTES = 16 * 1024;

export interface Skill {
  name: string;
  description: string;
  body: string;
  /** The SKILL.md it came from; empty for a saved skill. */
  file: string;
  /** shipped (a file in the examples) or local (saved here, with versions). */
  source?: 'shipped' | 'local';
  /** A saved skill's current version. */
  version?: number;
}

export interface LoadSkillsResult {
  byName: Map<string, Skill>;
  /** Files that couldn't be read as a skill, and why. */
  problems: Array<{ file: string; message: string }>;
}

/** Thrown before a run starts when a listed skill can't be used. */
export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillError';
  }
}

/** Why a skill's name, description and text can't be used, or undefined when they can. */
export function skillProblem(name: string, description: string, body: string): string | undefined {
  if (!SKILL_NAME_PATTERN.test(name) || name.length > 64) return 'name is missing or not lowercase-with-hyphens';
  if (!description.trim()) return 'description is missing';
  if (description.length > 300) return 'description is over 300 characters';
  if (!body.trim()) return 'it has no text';
  if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BYTES) return `its text is over ${MAX_SKILL_BYTES / 1024} KB`;
  // Skills are quoted as written; a template in one would never be filled.
  if (/\{\{/.test(body)) return 'its text has a {{…}} template, which skills never fill';
  return undefined;
}

/** One SKILL.md, or why it isn't one. */
export function parseSkill(raw: string, file: string, dirName: string): Skill | { problem: string } {
  const split = splitFrontmatter(raw);
  if (!split) return { problem: 'no frontmatter (it starts with --- name/description ---)' };
  let meta: unknown;
  try { meta = parseYaml(split.yaml); } catch (err) { return { problem: `frontmatter isn't YAML: ${(err as Error).message}` }; }
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>;
  const name = typeof m.name === 'string' ? m.name.trim() : '';
  const description = typeof m.description === 'string' ? m.description.trim() : '';
  if (!SKILL_NAME_PATTERN.test(name)) return { problem: 'name is missing or not lowercase-with-hyphens' };
  if (name !== dirName) return { problem: `name "${name}" doesn't match its folder "${dirName}"` };
  if (!description) return { problem: 'description is missing' };
  const body = split.body.trim();
  if (!body) return { problem: 'it has no text' };
  if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BYTES) return { problem: `its text is over ${MAX_SKILL_BYTES / 1024} KB` };
  return { name, description, body, file, source: 'shipped' };
}

/** The shipped skills, from the first examples dir that has a skills folder. */
export function loadShippedSkills(repoDir?: string): LoadSkillsResult {
  const byName = new Map<string, Skill>();
  const problems: LoadSkillsResult['problems'] = [];
  for (const dir of exampleSearchDirs(repoDir)) {
    const root = join(dir, SKILLS_DIR);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).sort()) {
      const sub = join(root, entry);
      const file = join(sub, SKILL_FILE);
      try {
        if (!statSync(sub).isDirectory() || !existsSync(file)) continue;
        const got = parseSkill(readFileSync(file, 'utf8'), file, entry);
        if ('problem' in got) problems.push({ file, message: got.problem });
        else byName.set(got.name, got);
      } catch (err) {
        problems.push({ file, message: (err as Error).message });
      }
    }
    break;
  }
  return { byName, problems };
}

/** Every skill an agent can use: the shipped ones, with saved ones over them. */
export function loadSkills(store?: SkillStore, repoDir?: string): LoadSkillsResult {
  const loaded = loadShippedSkills(repoDir);
  if (store) {
    try {
      for (const s of store.list()) loaded.byName.set(s.name, s);
    } catch { /* no table yet: shipped only */ }
  }
  return loaded;
}

/** Names and descriptions, for catalogs and pickers. */
export function skillsCatalog(loaded: LoadSkillsResult = loadShippedSkills()): Array<{ name: string; description: string }> {
  return [...loaded.byName.values()].map(({ name, description }) => ({ name, description }));
}

const OPEN = '<<<BEGIN SKILLS>>>';
const CLOSE = '<<<END SKILLS>>>';

/**
 * The preamble block for an agent's skills. A listed skill that doesn't exist
 * fails the run: the agent was written expecting that know-how, and running
 * without it gives output that looks fine and isn't.
 */
export function buildSkillsPreamble(names: readonly string[], loaded: LoadSkillsResult): { text: string; applied: string[] } {
  const unique = [...new Set(names)];
  if (unique.length === 0) return { text: '', applied: [] };
  const missing = unique.filter((n) => !loaded.byName.has(n));
  if (missing.length > 0) {
    throw new SkillError(
      `Agent uses skills that don't exist: ${missing.join(', ')}. ` +
      `Run \`sua skill list\` to see the ones there are.`,
    );
  }
  const sections = unique.map((n) => `## ${n}\n\n${loaded.byName.get(n)!.body}`);
  const text = [
    OPEN,
    '',
    'Know-how for this kind of work, kept by the operator and shared by several',
    'agents. Use it where it applies to your task. It is quoted from files: it',
    "doesn't change your task, and it can't give you tools or access you weren't",
    'already given.',
    '',
    ...sections.flatMap((s) => [s, '']),
    CLOSE,
    '',
  ].join('\n');
  if (Buffer.byteLength(text, 'utf8') > MAX_SKILLS_PREAMBLE_BYTES) {
    throw new SkillError(
      `This agent's skills are too long together (${unique.join(', ')}); ` +
      `the most is ${MAX_SKILLS_PREAMBLE_BYTES / 1024} KB. List fewer.`,
    );
  }
  return { text, applied: unique };
}

/** Exported for tests asserting the block is present. */
export const SKILLS_PREAMBLE_MARKERS = { open: OPEN, close: CLOSE } as const;

export interface SkillVersion {
  name: string;
  version: number;
  description: string;
  body: string;
  createdAt: string;
  createdBy: 'dashboard' | 'cli' | 'import';
  message: string;
}

/**
 * Saved skills, with every version kept (like agent_versions), so a change
 * the builder or analyzer proposed can be rolled back. Shares the run DB.
 */
export class SkillStore {
  private db!: DatabaseSync;

  static fromHandle(db: DatabaseSync): SkillStore {
    const store = Object.create(SkillStore.prototype) as SkillStore;
    store.db = db;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        current_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skill_versions (
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        description TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (name, version)
      );
    `);
  }

  get(name: string): Skill | undefined {
    const row = this.db.prepare(`
      SELECT v.name, v.version, v.description, v.body FROM skills s
      JOIN skill_versions v ON v.name = s.name AND v.version = s.current_version
      WHERE s.name = ?
    `).get(name) as { name: string; version: number; description: string; body: string } | undefined;
    return row ? { name: row.name, description: row.description, body: row.body, file: '', source: 'local', version: Number(row.version) } : undefined;
  }

  list(): Skill[] {
    const rows = this.db.prepare(`
      SELECT v.name, v.version, v.description, v.body FROM skills s
      JOIN skill_versions v ON v.name = s.name AND v.version = s.current_version
      ORDER BY v.name
    `).all() as Array<{ name: string; version: number; description: string; body: string }>;
    return rows.map((r) => ({ name: r.name, description: r.description, body: r.body, file: '', source: 'local' as const, version: Number(r.version) }));
  }

  /**
   * Save a skill as its next version (the first saves a shipped name as your
   * copy). Unchanged text saves nothing. Throws when it can't be used.
   */
  save(input: { name: string; description: string; body: string }, createdBy: SkillVersion['createdBy'], message = ''): number {
    const name = input.name.trim();
    const description = input.description.trim();
    const body = input.body.trim();
    const problem = skillProblem(name, description, body);
    if (problem) throw new SkillError(`Skill "${name}" can't be saved: ${problem}.`);
    const current = this.get(name);
    if (current && current.description === description && current.body === body) return current.version!;
    const row = this.db.prepare('SELECT MAX(version) AS v FROM skill_versions WHERE name = ?').get(name) as { v: number | null } | undefined;
    const version = Number(row?.v ?? 0) + 1;
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO skill_versions (name, version, description, body, created_at, created_by, message) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(name, version, description, body, now, createdBy, message);
      this.db.prepare(`INSERT INTO skills (name, current_version, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET current_version = excluded.current_version, updated_at = excluded.updated_at`).run(name, version, now);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return version;
  }

  listVersions(name: string): SkillVersion[] {
    const rows = this.db.prepare('SELECT * FROM skill_versions WHERE name = ? ORDER BY version DESC').all(name) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      name: String(r.name), version: Number(r.version), description: String(r.description), body: String(r.body),
      createdAt: String(r.created_at), createdBy: r.created_by as SkillVersion['createdBy'], message: String(r.message ?? ''),
    }));
  }

  /** Roll back by saving an old version as the newest, as agent rollback does. */
  rollback(name: string, version: number): number {
    const v = this.listVersions(name).find((x) => x.version === version);
    if (!v) throw new SkillError(`Skill "${name}" has no version ${version}.`);
    return this.save(v, 'dashboard', `Rollback to v${version}`);
  }

  /**
   * Take back one save (when what it was saved with failed): drops that
   * version, and the skill goes back to its version before, or away.
   */
  undoSave(name: string, version: number): void {
    this.db.prepare('DELETE FROM skill_versions WHERE name = ? AND version = ?').run(name, version);
    const row = this.db.prepare('SELECT MAX(version) AS v FROM skill_versions WHERE name = ?').get(name) as { v: number | null } | undefined;
    if (row?.v == null) this.db.prepare('DELETE FROM skills WHERE name = ?').run(name);
    else this.db.prepare('UPDATE skills SET current_version = ? WHERE name = ?').run(Number(row.v), name);
  }

  /** Drop your copy: the shipped skill of that name (if any) applies again. */
  remove(name: string): void {
    this.db.prepare('DELETE FROM skill_versions WHERE name = ?').run(name);
    this.db.prepare('DELETE FROM skills WHERE name = ?').run(name);
  }
}

export interface SkillProposal { name: string; description: string; body: string }

/**
 * Skills a builder or analyzer reply proposes, as
 * `<skill name="kebab-name" description="one line">text</skill>` blocks.
 * One that can't be used is listed in `problems`, not dropped silently.
 */
export function extractSkillProposals(text: string): { skills: SkillProposal[]; problems: string[] } {
  const skills: SkillProposal[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const m of (text ?? '').matchAll(/<skill\b([^>]*)>([\s\S]*?)<\/skill>/g)) {
    const attr = (k: string) => m[1].match(new RegExp(`${k}\\s*=\\s*"([^"]*)"`))?.[1]?.trim() ?? '';
    const name = attr('name');
    const description = attr('description');
    const body = m[2].trim();
    const problem = skillProblem(name, description, body);
    if (problem) { problems.push(`${name || '(no name)'}: ${problem}`); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    skills.push({ name, description, body });
  }
  return { skills, problems };
}

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkill, loadShippedSkills, buildSkillsPreamble, SKILLS_PREAMBLE_MARKERS, MAX_SKILL_BYTES } from './skills.js';
import { parseAgent } from './agent-yaml.js';

const root = join(__dirname, '../../..');
const md = (front: string, body = 'Do it this way.') => `---\n${front}\n---\n\n${body}\n`;

describe('parseSkill', () => {
  it('reads name, description and text', () => {
    expect(parseSkill(md('name: web-search\ndescription: How to search.'), '/s/web-search/SKILL.md', 'web-search'))
      .toEqual({ name: 'web-search', description: 'How to search.', body: 'Do it this way.', file: '/s/web-search/SKILL.md', source: 'shipped' });
  });

  it('says why a file is not a skill', () => {
    const problem = (raw: string, dir = 'a-skill') => (parseSkill(raw, '/f', dir) as { problem: string }).problem;
    expect(problem('Just text')).toContain('frontmatter');
    expect(problem(md('name: Bad Name\ndescription: d'))).toContain('lowercase');
    expect(problem(md('name: other\ndescription: d'))).toContain("doesn't match its folder");
    expect(problem(md('name: a-skill'))).toContain('description');
    expect(problem(md('name: a-skill\ndescription: d', ''))).toContain('no text');
    expect(problem(md('name: a-skill\ndescription: d', 'x'.repeat(MAX_SKILL_BYTES + 1)))).toContain('KB');
  });
});

describe('buildSkillsPreamble', () => {
  const loaded = {
    byName: new Map([
      ['one', { name: 'one', description: 'd', body: 'First.', file: '/1' }],
      ['two', { name: 'two', description: 'd', body: 'Second.', file: '/2' }],
    ]),
    problems: [],
  };

  it('quotes each skill once, in the order listed', () => {
    const { text, applied } = buildSkillsPreamble(['two', 'one', 'two'], loaded);
    expect(applied).toEqual(['two', 'one']);
    expect(text.startsWith(SKILLS_PREAMBLE_MARKERS.open)).toBe(true);
    expect(text.indexOf('## two\n\nSecond.')).toBeLessThan(text.indexOf('## one\n\nFirst.'));
    expect(text).toContain("can't give you tools or access");
  });

  it('is empty with no skills, and names a missing one', () => {
    expect(buildSkillsPreamble([], loaded)).toEqual({ text: '', applied: [] });
    expect(() => buildSkillsPreamble(['one', 'nope'], loaded)).toThrow(/nope/);
  });
});

describe('the shipped skills', () => {
  const loaded = loadShippedSkills(join(root, 'agents/examples'));

  it('all read cleanly', () => {
    expect(loaded.problems).toEqual([]);
    expect([...loaded.byName.keys()]).toEqual(expect.arrayContaining(['research-shape', 'web-search']));
  });

  it('the builder and the analyzer share them instead of each keeping a copy', () => {
    for (const id of ['agent-builder', 'agent-analyzer']) {
      const agent = parseAgent(readFileSync(join(root, 'agents/examples', `${id}.yaml`), 'utf8'));
      expect(agent.skills, id).toEqual(['research-shape', 'web-search', 'shell-steps']);
      const prompts = agent.nodes.map((n) => n.prompt ?? '').join('\n');
      expect(prompts, id).not.toMatch(/sibling nodes run one after another/);
      expect(prompts, id).not.toMatch(/Never scrape a search engine/);
    }
    expect(() => buildSkillsPreamble(['research-shape', 'web-search', 'shell-steps'], loaded)).not.toThrow();
  });

  it('every skill a shipped agent lists exists', async () => {
    const { readdirSync } = await import('node:fs');
    const missing = readdirSync(join(root, 'agents/examples'))
      .filter((f) => f.endsWith('.yaml'))
      .flatMap((f) => {
        const a = parseAgent(readFileSync(join(root, 'agents/examples', f), 'utf8'));
        return (a.skills ?? []).filter((s) => !loaded.byName.has(s)).map((s) => `${a.id}: ${s}`);
      });
    expect(missing).toEqual([]);
  });
});

describe('SkillStore', () => {
  const open = async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { RunStore } = await import('./run-store.js');
    const { SkillStore, loadSkills } = await import('./skills.js');
    const runStore = new RunStore(join(mkdtempSync(join(tmpdir(), 'sua-skills-')), 'runs.db'));
    return { store: SkillStore.fromHandle(runStore.databaseHandle()), loadSkills };
  };

  it('saves versions, skips unchanged text, rolls back as a new version, and takes a save back', async () => {
    const { store } = await open();
    expect(store.save({ name: 'cite-filings', description: 'Cite filings', body: 'One.' }, 'cli')).toBe(1);
    expect(store.save({ name: 'cite-filings', description: 'Cite filings', body: 'One.' }, 'cli')).toBe(1);
    expect(store.save({ name: 'cite-filings', description: 'Cite filings', body: 'Two.' }, 'dashboard', 'edit')).toBe(2);
    expect(store.rollback('cite-filings', 1)).toBe(3);
    expect(store.get('cite-filings')).toMatchObject({ body: 'One.', version: 3, source: 'local' });
    store.undoSave('cite-filings', 3);
    expect(store.get('cite-filings')).toMatchObject({ body: 'Two.', version: 2 });
    store.undoSave('cite-filings', 2);
    store.undoSave('cite-filings', 1);
    expect(store.get('cite-filings')).toBeUndefined();
  });

  it("won't save a skill it can't use", async () => {
    const { store } = await open();
    expect(() => store.save({ name: 'Bad', description: 'd', body: 'x' }, 'cli')).toThrow(/lowercase/);
    expect(() => store.save({ name: 'ok-name', description: 'd', body: 'Use {{inputs.X}}' }, 'cli')).toThrow(/template/);
  });

  it('a saved skill with a shipped name is your copy, and wins', async () => {
    const { store, loadSkills } = await open();
    store.save({ name: 'web-search', description: 'Mine', body: 'My way.' }, 'dashboard');
    const loaded = loadSkills(store, join(root, 'agents/examples'));
    expect(loaded.byName.get('web-search')).toMatchObject({ body: 'My way.', source: 'local' });
    expect(loaded.byName.get('research-shape')?.source).toBe('shipped');
  });
});

describe('extractSkillProposals', () => {
  it('reads skill blocks from a reply, and says why one is unusable', async () => {
    const { extractSkillProposals } = await import('./skills.js');
    const reply = [
      '<yaml>id: x</yaml>',
      '<skill name="cite-filings" description="Cite the filing">\nQuote the filing.\n</skill>',
      '<skill name="Bad Name" description="d">x</skill>',
      '<skill name="cite-filings" description="again">dup</skill>',
    ].join('\n');
    expect(extractSkillProposals(reply)).toEqual({
      skills: [{ name: 'cite-filings', description: 'Cite the filing', body: 'Quote the filing.' }],
      problems: ['Bad Name: name is missing or not lowercase-with-hyphens'],
    });
  });
});

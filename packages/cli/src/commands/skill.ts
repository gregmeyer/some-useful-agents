/**
 * `sua skill` — the skills agents share (docs/skills.md): the shipped files
 * under agents/examples/skills/, and the ones saved in the run database
 * (proposed by sua and approved, or your copy of a shipped one), which win.
 */

import { Command } from 'commander';
import { loadSkills, RunStore, SkillStore } from '@some-useful-agents/core';
import { loadConfig, getDbPath } from '../config.js';
import * as ui from '../ui.js';

function skills() {
  let store: SkillStore | undefined;
  try { store = SkillStore.fromHandle(new RunStore(getDbPath(loadConfig())).databaseHandle()); } catch { store = undefined; }
  return loadSkills(store);
}

export const skillCommand = new Command('skill')
  .description('List and show the skills agents share (skills/<name>/SKILL.md)');

skillCommand
  .command('list')
  .description('Every skill, with what it is for')
  .action(() => {
    const { byName, problems } = skills();
    if (byName.size === 0 && problems.length === 0) {
      ui.info('No skills found.');
      return;
    }
    for (const s of byName.values()) console.log(`${ui.id(s.name)}${s.source === 'local' ? ui.dim(` (yours, v${s.version})`) : ''}  ${s.description}`);
    for (const p of problems) ui.warn(`${p.file}: ${p.message}`);
  });

skillCommand
  .command('show <name>')
  .description("A skill's full text, as agents get it")
  .action((name: string) => {
    const skill = skills().byName.get(name);
    if (!skill) {
      ui.fail(`No skill "${name}". Run ${ui.cmd('sua skill list')} to see them.`);
      process.exitCode = 1;
      return;
    }
    ui.section(skill.name);
    console.log(ui.dim(skill.description));
    console.log(ui.dim(skill.file || `saved here, v${skill.version}`));
    console.log('');
    console.log(skill.body);
  });

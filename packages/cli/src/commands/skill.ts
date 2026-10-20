/**
 * `sua skill` — the skills agents share (docs/skills.md). Read-only: skills
 * are files under agents/examples/skills/, edited like any example.
 */

import { Command } from 'commander';
import { loadShippedSkills } from '@some-useful-agents/core';
import * as ui from '../ui.js';

export const skillCommand = new Command('skill')
  .description('List and show the skills agents share (skills/<name>/SKILL.md)');

skillCommand
  .command('list')
  .description('Every skill, with what it is for')
  .action(() => {
    const { byName, problems } = loadShippedSkills();
    if (byName.size === 0 && problems.length === 0) {
      ui.info('No skills found.');
      return;
    }
    for (const s of byName.values()) console.log(`${ui.id(s.name)}  ${s.description}`);
    for (const p of problems) ui.warn(`${p.file}: ${p.message}`);
  });

skillCommand
  .command('show <name>')
  .description("A skill's full text, as agents get it")
  .action((name: string) => {
    const skill = loadShippedSkills().byName.get(name);
    if (!skill) {
      ui.fail(`No skill "${name}". Run ${ui.cmd('sua skill list')} to see them.`);
      process.exitCode = 1;
      return;
    }
    ui.section(skill.name);
    console.log(ui.dim(skill.description));
    console.log(ui.dim(skill.file));
    console.log('');
    console.log(skill.body);
  });

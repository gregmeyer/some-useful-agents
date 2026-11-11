import { describe, it, expect } from 'vitest';
import { notebookKind, notebookStartPills } from './home-suggestions.js';

describe('ways to start a notebook (Home, Ask sua)', () => {
  const nb = (title: string, extra: Record<string, unknown> = {}) => ({ title, statement: '', ...extra }) as never;
  it('tells what a notebook is for: a meeting, a report, a plan, or choosing', () => {
    expect(notebookKind(nb('Prepare for a meeting with Dana Reyes'))).toBe('meeting');
    expect(notebookKind(nb('Acme', { layout: { preset: 'dossier', components: [] } }))).toBe('meeting');
    expect(notebookKind(nb('Know Acme', { steps: [{ kind: 'profile' }] }))).toBe('meeting');
    expect(notebookKind(nb('Is a heat pump worth it in a cold climate?'))).toBe('report');
    expect(notebookKind(nb('Plan 4 days in Lisbon'))).toBe('plan');
    expect(notebookKind(nb('Buy a used AWD wagon'))).toBe('choose');
  });

  it('offers your templates first, then the kinds you made, then a meeting and a report, to make three', () => {
    const tpl = (name: string, uses: number, subject?: boolean) => ({ name, uses, setup: { statement: '', steps: [], ...(subject ? { subject: { label: 'Who you\'re meeting', example: 'Dana Reyes' } } : {}) } }) as never;
    // Nothing yet: the two everyone has.
    expect(notebookStartPills([], []).map((p) => p.label)).toEqual(['Meeting with …', 'Report on …']);
    // A meeting and shortlists made, one template that changes each time.
    const pills = notebookStartPills([tpl('Meeting prep', 3, true), tpl('Old one', 0)], [nb('Prepare for a meeting with Dana Reyes'), nb('Buy a used AWD wagon'), nb('Pick a standing desk'), nb('Gone', { archivedAt: 'x' })]);
    expect(pills.map((p) => p.label)).toEqual(['Meeting prep for …', 'Old one', 'Choose …', 'Report on …']);
    // A template fills the box for sua (ends where you say who); a kind opens New notebook with its sentence started.
    expect(pills[0]).toEqual({ label: 'Meeting prep for …', text: 'Start a new notebook from my “Meeting prep” template for ' });
    expect(pills[1].text).toBe('Start a new notebook from my “Old one” template.');
    expect(pills[2]).toEqual({ label: 'Choose …', text: 'Help me choose ', href: '/notebooks/new?text=Help%20me%20choose%20' });
  });
});

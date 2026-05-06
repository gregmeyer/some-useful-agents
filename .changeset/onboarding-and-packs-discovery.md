---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Onboarding + discovery for widget packs and Build-from-goal.

- **Home page** (`/`) gains a "Build from goal" CTA + "Browse packs"
  link in the header. The wizard modal markup is now a shared partial
  (`build-from-goal-modal.ts`) used by both the home page and
  `/agents`. New users start their session with the wizard one click
  away instead of having to navigate into Agents first.
- **Dashboard tutorial** gains an 8th step ("Install a widget pack")
  that points users at `/packs`, marks itself done when any pack has
  `installed_at` set, and explains the dashboards switcher dropdown.
- **CLI tutorial outro** now closes with a "Want a richer experience?"
  block: `sua dashboard start` plus the three surfaces worth visiting
  first (Packs, Pulse, Build from goal).
- **README** "What you get" gains Widget packs + Dashboards bullets;
  the Output widgets bullet now mentions the `{{#if}}` / `{{#unless}}`
  / `{{#each}}` grammar and inline widget controls; the Dashboard
  section documents `/packs`, `/dashboards/:id`, the editor, and the
  Pulse "Hide all" / "Show all" bulk-toggle.

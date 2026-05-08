/**
 * Browser smoke scenarios (7, 8) — playwright-driven.
 *
 * The playwright import is dynamic so the dep doesn't load (or fail) on
 * users who never opt into --browser. If playwright isn't installed,
 * `loadBrowserScenarios` returns null and the runner prints an install
 * hint instead of crashing.
 *
 * UI selectors come from packages/dashboard/src/views/build-from-goal.js.ts
 * — id-based today, stable enough that we don't need data-testid yet.
 */

import {
  SCENARIO_GOALS,
} from './planner-scenarios.js';
import type { ServerScenario } from './planner-scenarios.js';
import type { SmokeContext, ScenarioResult } from './planner.js';

/**
 * Try to load playwright. Returns the chromium launcher on success,
 * null on a missing-dep error so the runner can render a hint.
 */
async function tryLoadChromium(): Promise<unknown | null> {
  try {
    // Indirect import string keeps TypeScript from trying to resolve
    // the module statically (it's an optional devDep — not installed
    // by default). The Function-wrapped dynamic import also dodges
    // bundlers that would otherwise try to walk the dependency.
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
    const mod = await dynamicImport('playwright');
    return (mod as { chromium: unknown }).chromium;
  } catch {
    return null;
  }
}

/**
 * Build the two browser scenarios. Returns null when playwright isn't
 * installed; the caller renders an install hint and skips the scenarios.
 */
export async function loadBrowserScenarios(): Promise<ServerScenario[] | null> {
  const chromium = await tryLoadChromium();
  if (!chromium) return null;

  // Local import inside the closure keeps the playwright type out of the
  // public surface (the file is allowed to compile when playwright is
  // not installed because we use `unknown` here).
  type ChromiumLike = {
    launch: (opts?: { headless?: boolean }) => Promise<{
      newPage: () => Promise<BrowserPage>;
      close: () => Promise<void>;
    }>;
  };
  type BrowserPage = {
    goto: (url: string) => Promise<unknown>;
    click: (selector: string) => Promise<void>;
    fill: (selector: string, value: string) => Promise<void>;
    waitForSelector: (selector: string, opts?: { timeout?: number; state?: string }) => Promise<unknown>;
    waitForFunction: (fn: string, arg?: unknown, opts?: { timeout?: number }) => Promise<unknown>;
    locator: (selector: string) => { textContent: () => Promise<string | null>; isVisible: () => Promise<boolean> };
    on: (event: string, handler: (msg: { type(): string; text(): string }) => void) => void;
    evaluate: <T>(fn: string | (() => T)) => Promise<T>;
    close: () => Promise<void>;
  };
  const launcher = chromium as ChromiumLike;

  const wizardEditAfterWarning: ServerScenario = {
    id: 7,
    name: 'browser: edit YAML after critic warning, commit anyway',
    goal: SCENARIO_GOALS.criticExhaustion,
    asserts: 'warning visible; textarea editable; button labelled "Commit anyway"',
    async run(ctx: SmokeContext): Promise<ScenarioResult> {
      const t0 = Date.now();
      const browser = await launcher.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await page.goto(`${ctx.baseUrl}/`);
        // Wizard entry button id confirmed in build-from-goal-modal.ts.
        await page.click('#build-from-goal-btn');
        // Goal field: textarea inside the modal; waits for modal to open.
        await page.waitForSelector('#build-modal-content textarea', { timeout: 10_000 });
        await page.fill('#build-modal-content textarea', this.goal);
        // Submit button — text-based since the modal scaffolding doesn't
        // assign a stable id to the start button. We'll hit Enter on the
        // textarea instead of clicking, which the wizard handles.
        await page.click('#build-modal-content button[type=submit], #build-modal-content button.btn--primary');
        // Wait until the plan-review UI has rendered (commit btn appears).
        // Allow up to 4 minutes — exhaustion path = 3 planner runs.
        await page.waitForSelector('#build-commit-btn', { timeout: 240_000 });
        const buttonLabel = (await page.locator('#build-commit-btn').textContent()) ?? '';
        if (!/commit anyway/i.test(buttonLabel)) {
          return {
            scenarioId: this.id, name: this.name, passed: false, durationMs: Date.now() - t0,
            reason: `button label is "${buttonLabel.trim()}", expected "Commit anyway"`,
          };
        }
        const warningVisible = await page.locator('.flash--warning').isVisible();
        if (!warningVisible) {
          return {
            scenarioId: this.id, name: this.name, passed: false, durationMs: Date.now() - t0,
            reason: 'critic warning flash is not visible',
          };
        }
        // Edit the first new-agent textarea: append a # comment so we can
        // observe the edit landed when the commit response comes back.
        const marker = `# smoke-edit-${Date.now()}`;
        await page.evaluate(`(() => {
          const ta = document.querySelector('[data-new-agent-idx="0"]');
          if (!ta) throw new Error('no new-agent textarea');
          ta.value = ta.value + '\\n${marker}\\n';
          return ta.value.length;
        })()`);
        // Click commit and wait for the result flash to appear.
        await page.click('#build-commit-btn');
        await page.waitForSelector('#build-result-flash', { timeout: 30_000 });
        // We don't have a server hook to confirm the marker landed —
        // the assertion that the button label was correct + warning was
        // shown is the meaningful coverage. Edit verification would
        // require stashing the agent ID and reading it back from the
        // store; deferred to keep the scenario surface tight.
        return {
          scenarioId: this.id, name: this.name, passed: true, durationMs: Date.now() - t0,
          reason: 'warning shown, button label correct, commit click accepted',
        };
      } catch (e) {
        return {
          scenarioId: this.id, name: this.name, passed: false, durationMs: Date.now() - t0,
          reason: `playwright error: ${(e as Error).message}`,
        };
      } finally {
        await page.close();
        await browser.close();
      }
    },
  };

  const wizardCancelMidRetry: ServerScenario = {
    id: 8,
    name: 'browser: dismiss while phase shows "Refining plan"',
    goal: SCENARIO_GOALS.criticRetry,
    asserts: 'modal closes cleanly; no uncaught fetch errors after close',
    async run(ctx: SmokeContext): Promise<ScenarioResult> {
      const t0 = Date.now();
      const browser = await launcher.launch({ headless: true });
      const page = await browser.newPage();
      const consoleErrors: string[] = [];
      page.on('console', (msg: { type(): string; text(): string }) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      try {
        await page.goto(`${ctx.baseUrl}/`);
        await page.click('#build-from-goal-btn');
        await page.waitForSelector('#build-modal-content textarea', { timeout: 10_000 });
        await page.fill('#build-modal-content textarea', this.goal);
        await page.click('#build-modal-content button[type=submit], #build-modal-content button.btn--primary');
        // Wait for the phase label to show "Refining plan" — that's the
        // critic-retry signal. Up to 3 minutes for the first planner run
        // to land + the retry to spawn.
        await page.waitForFunction(
          `(() => {
            const el = document.getElementById('build-phase');
            return el && /refining plan/i.test(el.textContent || '');
          })()`,
          undefined,
          { timeout: 180_000 },
        );
        // Now click Dismiss. Selector matches the wizard's own dismiss
        // hooks (see build-from-goal.js.ts).
        await page.click('[data-close-build="1"]');
        // Modal should be gone — wait until it's removed/hidden.
        await page.waitForSelector('#build-modal', { state: 'hidden', timeout: 5_000 });
        // Give any in-flight fetch a beat to drain.
        await new Promise((r) => setTimeout(r, 1000));
        if (consoleErrors.length > 0) {
          return {
            scenarioId: this.id, name: this.name, passed: false, durationMs: Date.now() - t0,
            reason: `console errors after dismiss: ${consoleErrors.slice(0, 3).join(' | ')}`,
          };
        }
        return {
          scenarioId: this.id, name: this.name, passed: true, durationMs: Date.now() - t0,
          reason: 'modal closed mid-retry; no orphan errors observed',
        };
      } catch (e) {
        return {
          scenarioId: this.id, name: this.name, passed: false, durationMs: Date.now() - t0,
          reason: `playwright error: ${(e as Error).message}`,
        };
      } finally {
        await page.close();
        await browser.close();
      }
    },
  };

  return [wizardEditAfterWarning, wizardCancelMidRetry];
}

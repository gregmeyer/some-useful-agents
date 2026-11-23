/**
 * Work the dashboard starts and doesn't wait for (triage turns, notebook
 * steps, page decisions, webhook runs). Each launch goes through
 * `inBackground` instead of a bare `void promise`, so the dashboard knows
 * what's still running. Shutdown and test teardown can wait it out, and a
 * failure nobody caught is logged with its label instead of surfacing as an
 * anonymous unhandled rejection.
 */

export class BackgroundTasks {
  private readonly tasks = new Map<Promise<void>, string>();

  /** Track `work` until it settles. Its result is ignored; an uncaught failure is logged. */
  run(label: string, work: PromiseLike<unknown>): void {
    const tracked: Promise<void> = Promise.resolve(work).then(
      () => undefined,
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[background] ${label} failed: ${message}`);
      },
    );
    this.tasks.set(tracked, label);
    void tracked.finally(() => this.tasks.delete(tracked));
  }

  /** How many launches haven't settled yet. */
  get size(): number {
    return this.tasks.size;
  }

  /** Labels of the launches still running, oldest first. */
  pending(): string[] {
    return [...this.tasks.values()];
  }

  /**
   * Wait until nothing is running, including work that running work starts,
   * or until `timeoutMs` passes. Returns the labels still running then
   * (empty when everything finished).
   */
  async drain(timeoutMs = 3000): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.tasks.size > 0) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(this.tasks.keys()),
        new Promise<void>((r) => { timer = setTimeout(r, left); }),
      ]);
      clearTimeout(timer);
    }
    return this.pending();
  }
}

/**
 * Start `work` without waiting for it, tracked on `ctx.background`. Created
 * on first use, so a context built by hand (as tests do) is tracked too.
 */
export function inBackground(ctx: { background?: BackgroundTasks }, label: string, work: PromiseLike<unknown>): void {
  (ctx.background ??= new BackgroundTasks()).run(label, work);
}

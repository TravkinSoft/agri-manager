export type ReadSnapshot<T> = { data: T | null; error: Error | null; loading: boolean };

/** Component-owned read state: no module/global cross-actor cache. Invalidation
 * joins an in-flight read, then coalesces actual changes into one follow-up.
 * Navigation/cancellation and timeout cannot publish a late result.
 */
export class ScopedReadResource<T> {
  private snapshot: ReadSnapshot<T> = { data: null, error: null, loading: false };
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private loadedAt = 0;
  private dirty = false;

  constructor(private ttlMs = 30_000, private timeoutMs = 30_000, private now = Date.now) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: ReadSnapshot<T>) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  request(loader: (signal: AbortSignal) => Promise<T>, force = false): Promise<void> {
    if (this.pending) {
      if (force) this.dirty = true;
      return this.pending;
    }
    if (!force && this.snapshot.data !== null && this.now() - this.loadedAt < this.ttlMs) return Promise.resolve();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.dirty = false;
    this.publish({ ...this.snapshot, error: null, loading: true });
    let timeout: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const deadline = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason || new Error("Read canceled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      timeout = setTimeout(() => {
        const error = new Error("Read timed out");
        error.name = "TimeoutError";
        controller.abort(error);
      }, this.timeoutMs);
    });
    this.pending = Promise.race([Promise.resolve().then(() => loader(controller.signal)), deadline])
      .then((data) => {
        if (generation !== this.generation || controller.signal.aborted) return;
        this.loadedAt = this.now();
        this.publish({ data, error: null, loading: false });
      })
      .catch((reason) => {
        if (generation !== this.generation) return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        this.publish({ ...this.snapshot, error, loading: false });
      })
      .finally(() => {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onAbort);
        if (generation !== this.generation) return;
        this.pending = null;
        this.controller = null;
        // Do not auto-loop on failed/expired requests. A visible retry is explicit.
        if (this.dirty && !this.snapshot.error) void this.request(loader, true);
      });
    return this.pending;
  }

  cancel() {
    this.generation++;
    this.dirty = false;
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    this.publish({ ...this.snapshot, loading: false });
  }
}

export function readErrorMessage(error: Error, subject: string): string {
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return `${subject}: сервер не ответил вовремя. Повторите загрузку.`;
  }
  return error.message || `${subject}: не удалось загрузить данные.`;
}

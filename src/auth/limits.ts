/**
 * Simple per-key rate limits, in memory (the app runs as one instance): at most `limit` calls
 * per `windowMs` for each key (an account and an action). Protects Supertext keys from being
 * tried in bulk (*Test connection*) and accounts from runaway translation requests.
 */
export class RateLimiter {
  private readonly calls = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a call; false when the key already made `limit` calls in the window. */
  take(key: string): boolean {
    const now = this.now();
    const recent = (this.calls.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.calls.set(key, recent);
      return false;
    }
    recent.push(now);
    this.calls.set(key, recent);
    if (this.calls.size > 10_000) {
      for (const [k, times] of this.calls) if (times.every((at) => now - at >= this.windowMs)) this.calls.delete(k);
    }
    return true;
  }
}

/** Request bodies: forms and JSON calls are small; only the import takes a file (MAX_UPLOAD_BYTES). */
export const MAX_BODY_BYTES = 1024 * 1024;

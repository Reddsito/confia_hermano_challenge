export interface RateWindow {
  /** Number of requests allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  seconds: number;
}

/**
 * Development and Personal keys are limited on two windows at once, so a
 * single token bucket is not enough. This tracks every window independently
 * and waits for whichever one is saturated.
 */
export const DEFAULT_WINDOWS: RateWindow[] = [
  { limit: 20, seconds: 1 },
  { limit: 100, seconds: 120 },
];

export class RateLimiter {
  private readonly windows: RateWindow[];
  private readonly hits: number[][];
  /** Serialises acquire() so concurrent callers cannot both pass the check. */
  private queue: Promise<void> = Promise.resolve();

  constructor(windows: RateWindow[] = DEFAULT_WINDOWS) {
    this.windows = windows;
    this.hits = windows.map(() => []);
  }

  /** Resolves once it is safe to fire one more request. */
  acquire(): Promise<void> {
    const next = this.queue.then(() => this.reserve());
    // Swallow rejections on the chain itself so one failure cannot poison it.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async reserve(): Promise<void> {
    for (;;) {
      const waitMs = this.millisecondsUntilSlot();
      if (waitMs <= 0) break;
      await sleep(waitMs);
    }

    const now = Date.now();
    this.hits.forEach((bucket) => bucket.push(now));
  }

  private millisecondsUntilSlot(): number {
    const now = Date.now();
    let wait = 0;

    this.windows.forEach((window, index) => {
      const windowMs = window.seconds * 1000;
      const bucket = this.hits[index]!;

      // Drop timestamps that have aged out of this window.
      while (bucket.length > 0 && now - bucket[0]! >= windowMs) {
        bucket.shift();
      }

      if (bucket.length >= window.limit) {
        const oldest = bucket[0]!;
        wait = Math.max(wait, oldest + windowMs - now);
      }
    });

    return wait;
  }

  /** Applied when Riot answers 429 with a Retry-After header. */
  penalise(seconds: number): void {
    const until = Date.now() + seconds * 1000;
    this.windows.forEach((window, index) => {
      const bucket = this.hits[index]!;
      const windowMs = window.seconds * 1000;
      // Fill the bucket with timestamps that only expire after the penalty.
      while (bucket.length < window.limit) {
        bucket.push(until - windowMs);
      }
    });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

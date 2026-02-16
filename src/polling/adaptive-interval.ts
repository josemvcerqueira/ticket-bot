import { setTimeout as sleep } from "node:timers/promises";

/**
 * Adaptive polling interval that speeds up when activity is detected
 * and slows down during idle periods.
 *
 * - Starts at `initialMs`
 * - Drops to `minMs` on activity (seats found)
 * - Gradually increases to `maxMs` when idle
 * - Backs off further on errors (429/503)
 */
/** Duration (ms) after a rate-limit during which onIdle() won't reduce the interval */
const RATE_LIMIT_COOLDOWN_MS = 30_000;

export class AdaptiveInterval {
  private currentMs: number;
  private idleCount = 0;
  /** Timestamp (Date.now()) until which rate-limit cooldown is active */
  private rateLimitCooldownUntil = 0;

  constructor(
    private readonly minMs: number,
    private readonly maxMs: number,
    private readonly initialMs: number,
  ) {
    this.currentMs = initialMs;
  }

  /** Call when seats were found - speed up polling */
  onActivity(): void {
    this.currentMs = this.minMs;
    this.idleCount = 0;
  }

  /** Call when no seats found - gradually slow down (respects rate-limit cooldown) */
  onIdle(): void {
    this.idleCount++;
    if (Date.now() < this.rateLimitCooldownUntil) {
      // During cooldown, don't recover — keep current interval
      return;
    }
    // Slow down by 10% each idle cycle, up to max
    this.currentMs = Math.min(this.currentMs * 1.1, this.maxMs);
  }

  /** Call on server error - back off more aggressively */
  onError(): void {
    this.currentMs = Math.min(this.currentMs * 2, this.maxMs);
  }

  /** Call on 429 rate-limit — back off 3x and set a cooldown window */
  onRateLimit(): void {
    this.currentMs = Math.min(this.currentMs * 3, this.maxMs);
    this.rateLimitCooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  }

  /** Get the current interval with random jitter (+/- 15%) */
  get(): number {
    const jitter = 0.85 + Math.random() * 0.3; // 0.85 to 1.15
    return Math.round(this.currentMs * jitter);
  }

  /** Wait for the current adaptive interval */
  async wait(signal?: AbortSignal): Promise<void> {
    const ms = this.get();
    await sleep(ms, undefined, { signal });
  }
}

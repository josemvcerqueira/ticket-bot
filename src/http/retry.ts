import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "../utils/logger.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

/** HTTP status codes that should never be retried */
const NON_RETRYABLE = new Set([400, 401, 403, 404]);

/**
 * Retry a function with exponential backoff + jitter.
 * Skips retries for 400/401/403/404; retries 408, 429, and 5xx.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500, maxDelayMs = 15_000, signal } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted();

    try {
      return await fn();
    } catch (err: unknown) {
      // Never retry non-retryable HTTP status codes
      if (err instanceof HttpError && NON_RETRYABLE.has(err.status)) {
        throw err;
      }

      if (attempt === maxRetries) throw err;

      const delay = Math.min(
        baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs,
        maxDelayMs,
      );

      const status = err instanceof HttpError ? err.status : undefined;
      logger.warn(
        { attempt: attempt + 1, maxRetries, delay: Math.round(delay), status },
        `[${label}] Retrying after error`,
      );

      await sleep(delay, undefined, { signal });
    }
  }

  throw new Error("unreachable");
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

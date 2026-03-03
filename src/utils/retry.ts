import { writeError, EXIT_RATE_LIMITED } from "../output/errors.js";

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 4) */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 10000 = 10s) */
  baseDelayMs?: number;
}

/**
 * Execute an async function with exponential-backoff retry on rate-limit errors.
 *
 * Only retries when the error looks like a 429 / rate-limit response.
 * All other errors are re-thrown immediately.
 *
 * Default base delay is 10s, giving a backoff sequence of:
 *   attempt 1: 10s, attempt 2: 20s, attempt 3: 40s, attempt 4: 80s
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 4, baseDelayMs = 10_000 } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err)) throw err; // only retry on 429
      lastError = err;
      const delay = baseDelayMs * 2 ** attempt;
      writeError(
        `Rate limited — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`,
        EXIT_RATE_LIMITED,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Check whether an error represents a rate-limit (429) response.
 */
export function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    return m.includes("rate limit") || m.includes("429") || m.includes("too many");
  }
  return false;
}

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry, isRateLimitError, sleep } from "../../src/utils/retry.js";

// Suppress writeError output during tests
vi.mock("../../src/output/errors.js", () => ({
  writeError: vi.fn(),
  EXIT_RATE_LIMITED: 3,
}));

describe("retry utility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("withRetry", () => {
    it("returns the value on first success", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await withRetry(fn, { baseDelayMs: 1 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on rate-limit errors and succeeds", async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error("429 Too Many Requests"))
        .mockRejectedValueOnce(new Error("rate limit exceeded"))
        .mockResolvedValue("finally");

      const result = await withRetry(fn, { maxAttempts: 4, baseDelayMs: 1 });
      expect(result).toBe("finally");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("throws the last error when all retries are exhausted", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("429 Too Many Requests"));

      await expect(
        withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
      ).rejects.toThrow("429 Too Many Requests");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("throws non-rate-limit errors immediately without retrying", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("Internal server error"));

      await expect(
        withRetry(fn, { maxAttempts: 4, baseDelayMs: 1 }),
      ).rejects.toThrow("Internal server error");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("uses exponential backoff delays", async () => {
      const sleepSpy = vi.spyOn(globalThis, "setTimeout");

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error("429"))
        .mockRejectedValueOnce(new Error("429"))
        .mockResolvedValue("ok");

      await withRetry(fn, { maxAttempts: 4, baseDelayMs: 10 });

      // Collect the timeout delays that were passed to setTimeout
      const delays = sleepSpy.mock.calls
        .map((call) => call[1])
        .filter((d): d is number => typeof d === "number" && d >= 10);

      // First delay: 10 * 2^0 = 10, second delay: 10 * 2^1 = 20
      expect(delays).toContain(10);
      expect(delays).toContain(20);
    });

    it("defaults to 4 max attempts", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("too many requests"));

      await expect(
        withRetry(fn, { baseDelayMs: 1 }),
      ).rejects.toThrow("too many requests");
      expect(fn).toHaveBeenCalledTimes(4);
    });
  });

  describe("isRateLimitError", () => {
    it("returns true for 429 errors", () => {
      expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    });

    it("returns true for rate limit messages", () => {
      expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    });

    it("returns true for too many requests", () => {
      expect(isRateLimitError(new Error("too many requests"))).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(isRateLimitError(new Error("not found"))).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isRateLimitError("some string")).toBe(false);
      expect(isRateLimitError(42)).toBe(false);
      expect(isRateLimitError(null)).toBe(false);
    });
  });

  describe("sleep", () => {
    it("resolves after the given delay", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // allow small margin
    });
  });
});

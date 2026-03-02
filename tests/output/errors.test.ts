import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyError, EXIT_ERROR, EXIT_AUTH_ERROR, EXIT_RATE_LIMITED, EXIT_NOT_FOUND } from "../../src/output/errors.js";

// Mock isTTY
vi.mock("../../src/utils/tty.js", () => ({
  isTTY: () => false,
  isColorSupported: () => false,
}));

describe("Error Classification", () => {
  describe("classifyError()", () => {
    it("classifies auth errors by error name", () => {
      const error = Object.assign(new Error("Not authenticated"), { name: "AuthError" });
      const result = classifyError(error);
      expect(result.exitCode).toBe(EXIT_AUTH_ERROR);
    });

    it("classifies auth errors by message containing '401'", () => {
      const result = classifyError(new Error("HTTP 401 Unauthorized"));
      expect(result.exitCode).toBe(EXIT_AUTH_ERROR);
    });

    it("classifies auth errors by message containing 'unauthorized'", () => {
      const result = classifyError(new Error("Request unauthorized"));
      expect(result.exitCode).toBe(EXIT_AUTH_ERROR);
    });

    it("classifies auth errors by message containing 'not authenticated'", () => {
      const result = classifyError(new Error("Not authenticated. Run: granola auth login"));
      expect(result.exitCode).toBe(EXIT_AUTH_ERROR);
    });

    it("classifies rate limit errors", () => {
      const result = classifyError(new Error("HTTP 429 Too Many Requests"));
      expect(result.exitCode).toBe(EXIT_RATE_LIMITED);
    });

    it("classifies not found errors", () => {
      const result = classifyError(new Error("HTTP 404 Not Found"));
      expect(result.exitCode).toBe(EXIT_NOT_FOUND);
    });

    it("classifies generic errors as general errors", () => {
      const result = classifyError(new Error("Something went wrong"));
      expect(result.exitCode).toBe(EXIT_ERROR);
    });

    it("handles non-Error objects", () => {
      const result = classifyError("string error");
      expect(result.exitCode).toBe(EXIT_ERROR);
      expect(result.message).toBe("string error");
    });

    it("handles null/undefined", () => {
      const result = classifyError(null);
      expect(result.exitCode).toBe(EXIT_ERROR);
    });
  });
});

import { describe, it, expect } from "vitest";
import { parseDate, formatDate, formatRelative } from "../../src/utils/dates.js";

describe("Date utilities", () => {
  describe("parseDate()", () => {
    it("passes through valid ISO 8601 dates", () => {
      const result = parseDate("2024-01-15");
      expect(result).toBeDefined();
      expect(result).toContain("2024-01-15");
    });

    it("parses ISO 8601 datetime strings", () => {
      const result = parseDate("2024-01-15T10:30:00Z");
      expect(result).toBeDefined();
      expect(result).toContain("2024-01-15");
    });

    it("parses natural language: yesterday", () => {
      const result = parseDate("yesterday");
      expect(result).toBeDefined();

      // Should be within the last 48 hours
      const date = new Date(result!);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      expect(date.getDate()).toBe(yesterday.getDate());
    });

    it("parses natural language: last week", () => {
      const result = parseDate("last week");
      expect(result).toBeDefined();

      const date = new Date(result!);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      // Should be within the last 2 weeks
      expect(date.getTime()).toBeLessThan(Date.now());
      expect(date.getTime()).toBeGreaterThan(Date.now() - 14 * 24 * 3600 * 1000);
    });

    it("parses natural language: 2 days ago", () => {
      const result = parseDate("2 days ago");
      expect(result).toBeDefined();

      const date = new Date(result!);
      const twoDaysAgo = Date.now() - 2 * 24 * 3600 * 1000;

      // Allow ±1 day tolerance
      expect(Math.abs(date.getTime() - twoDaysAgo)).toBeLessThan(24 * 3600 * 1000 + 60_000);
    });

    it("returns undefined for invalid input", () => {
      const result = parseDate("not a date at all xyz123");
      expect(result).toBeUndefined();
    });
  });

  describe("formatDate()", () => {
    it("formats a valid ISO date string", () => {
      const result = formatDate("2024-01-15T10:00:00Z");
      expect(typeof result).toBe("string");
      expect(result).not.toBe("—");
    });

    it("returns — for null/undefined", () => {
      expect(formatDate(null)).toBe("—");
      expect(formatDate(undefined)).toBe("—");
    });

    it("returns — for empty string", () => {
      expect(formatDate("")).toBe("—");
    });
  });

  describe("formatRelative()", () => {
    it("returns just now for very recent dates", () => {
      const result = formatRelative(new Date(Date.now() - 10_000).toISOString());
      expect(result).toBe("just now");
    });

    it("returns Xm ago for minutes", () => {
      const result = formatRelative(new Date(Date.now() - 5 * 60_000).toISOString());
      expect(result).toMatch(/^5m ago$/);
    });

    it("returns Xh ago for hours", () => {
      const result = formatRelative(new Date(Date.now() - 3 * 3600_000).toISOString());
      expect(result).toMatch(/^3h ago$/);
    });

    it("returns Xd ago for days", () => {
      const result = formatRelative(new Date(Date.now() - 5 * 86400_000).toISOString());
      expect(result).toMatch(/^5d ago$/);
    });

    it("returns — for null/undefined", () => {
      expect(formatRelative(null)).toBe("—");
      expect(formatRelative(undefined)).toBe("—");
    });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveFormat, resolveQueryFormat } from "../../src/output/formatter.js";

// Mock isTTY
vi.mock("../../src/utils/tty.js", () => ({
  isTTY: () => mockIsTTY,
  isColorSupported: () => false,
  defaultFormat: () => (mockIsTTY ? "text" : "json"),
}));

let mockIsTTY = false;

describe("Output Formatter", () => {
  afterEach(() => {
    mockIsTTY = false;
  });

  describe("resolveFormat()", () => {
    it("returns json when not TTY and no explicit format", () => {
      mockIsTTY = false;
      expect(resolveFormat()).toBe("json");
    });

    it("returns table when TTY and no explicit format", () => {
      mockIsTTY = true;
      expect(resolveFormat()).toBe("table");
    });

    it("respects explicit json format override", () => {
      mockIsTTY = true;
      expect(resolveFormat("json")).toBe("json");
    });

    it("respects explicit table format override", () => {
      mockIsTTY = false;
      expect(resolveFormat("table")).toBe("table");
    });

    it("respects explicit csv format", () => {
      expect(resolveFormat("csv")).toBe("csv");
    });

    it("respects explicit markdown format", () => {
      expect(resolveFormat("markdown")).toBe("markdown");
    });

    it("respects explicit text format", () => {
      expect(resolveFormat("text")).toBe("text");
    });

    it("normalizes format to lowercase", () => {
      expect(resolveFormat("JSON")).toBe("json");
    });

    it("falls back to auto-detect for invalid format", () => {
      mockIsTTY = false;
      expect(resolveFormat("invalid")).toBe("json");
    });
  });

  describe("resolveQueryFormat()", () => {
    it("returns json when not TTY and no explicit format", () => {
      mockIsTTY = false;
      expect(resolveQueryFormat()).toBe("json");
    });

    it("returns text when TTY and no explicit format", () => {
      mockIsTTY = true;
      expect(resolveQueryFormat()).toBe("text");
    });

    it("respects explicit format override", () => {
      mockIsTTY = true;
      expect(resolveQueryFormat("json")).toBe("json");
    });
  });
});

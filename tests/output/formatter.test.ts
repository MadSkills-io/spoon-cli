import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { resolveFormat, resolveQueryFormat, output } from "../../src/output/formatter.js";

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

  describe("output() with folder_membership", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it("includes folder_membership in JSON output", () => {
      const meeting = {
        id: "meeting-001",
        title: "Planning",
        folder_membership: [
          { id: "fol_AbCdEfGhIjKlMn", name: "Planning", object: "folder" },
        ],
      };

      output(meeting, "json");
      const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(printed).toContain("folder_membership");
      expect(printed).toContain("Planning");
    });

    it("shows folder in text output when folder_membership present", () => {
      const meeting = {
        id: "meeting-001",
        title: "Planning",
        folder_membership: [
          { id: "fol_AbCdEfGhIjKlMn", name: "My Folder", object: "folder" },
        ],
      };

      output(meeting, "text");
      const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(printed).toContain("Folder:");
      expect(printed).toContain("My Folder");
    });

    it("omits folder line in text output when folder_membership absent", () => {
      const meeting = {
        id: "meeting-001",
        title: "Planning",
      };

      output(meeting, "text");
      const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(printed).not.toContain("Folder:");
    });

    it("omits folder line in text output when folder_membership is empty", () => {
      const meeting = {
        id: "meeting-001",
        title: "Planning",
        folder_membership: [],
      };

      output(meeting, "text");
      const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(printed).not.toContain("Folder:");
    });

    it("joins multiple folder names with comma in text output", () => {
      const meeting = {
        id: "meeting-001",
        title: "Planning",
        folder_membership: [
          { id: "fol_Aaaa", name: "Folder A", object: "folder" },
          { id: "fol_Bbbb", name: "Folder B", object: "folder" },
        ],
      };

      output(meeting, "text");
      const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(printed).toContain("Folder A, Folder B");
    });
  });
});

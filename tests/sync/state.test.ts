import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";

// Mock homedir to use a temporary directory
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => testHomeDir,
  };
});

const testHomeDir = join(tmpdir(), `granola-sync-state-test-${process.pid}`);

describe("Sync State", () => {
  beforeEach(() => {
    mkdirSync(join(testHomeDir, ".spoon"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testHomeDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("returns default state when file does not exist", async () => {
    const { loadSyncState } = await import("../../src/sync/state.js");
    const state = loadSyncState();

    expect(state.lastSyncAt).toBeUndefined();
    expect(state.syncedMeetings).toEqual({});
  });

  it("saves and loads sync state", async () => {
    const { loadSyncState, saveSyncState } = await import("../../src/sync/state.js");

    const state = {
      lastSyncAt: "2024-01-20T10:00:00.000Z",
      syncedMeetings: {
        "meeting-001": "2024-01-20T10:00:01.000Z",
        "meeting-002": "2024-01-20T10:00:02.000Z",
      },
    };

    saveSyncState(state);
    const loaded = loadSyncState();

    expect(loaded.lastSyncAt).toBe("2024-01-20T10:00:00.000Z");
    expect(loaded.syncedMeetings["meeting-001"]).toBe("2024-01-20T10:00:01.000Z");
    expect(loaded.syncedMeetings["meeting-002"]).toBe("2024-01-20T10:00:02.000Z");
  });

  it("round-trips state data without loss", async () => {
    const { loadSyncState, saveSyncState } = await import("../../src/sync/state.js");

    const original = {
      lastSyncAt: "2024-06-15T14:30:00.000Z",
      syncedMeetings: {
        "abc": "2024-06-15T14:30:01.000Z",
      },
    };

    saveSyncState(original);
    const loaded = loadSyncState();

    expect(loaded).toEqual(original);
  });

  it("creates the .spoon directory if it does not exist", async () => {
    const { saveSyncState } = await import("../../src/sync/state.js");

    // Remove the .spoon dir
    rmSync(join(testHomeDir, ".spoon"), { recursive: true, force: true });

    saveSyncState({
      lastSyncAt: "2024-01-01T00:00:00.000Z",
      syncedMeetings: {},
    });

    expect(existsSync(join(testHomeDir, ".spoon", "sync-state.json"))).toBe(true);
  });

  it("writes valid JSON to the state file", async () => {
    const { saveSyncState, getStateFilePath } = await import("../../src/sync/state.js");

    saveSyncState({
      lastSyncAt: "2024-01-01T00:00:00.000Z",
      syncedMeetings: { "m1": "2024-01-01T00:00:01.000Z" },
    });

    const filePath = getStateFilePath();
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.lastSyncAt).toBe("2024-01-01T00:00:00.000Z");
    expect(parsed.syncedMeetings.m1).toBe("2024-01-01T00:00:01.000Z");
  });

  it("handles corrupted state file gracefully", async () => {
    const { loadSyncState, getStateFilePath } = await import("../../src/sync/state.js");
    const { writeFileSync } = await import("node:fs");

    writeFileSync(getStateFilePath(), "NOT VALID JSON {{{{", "utf-8");

    const state = loadSyncState();
    expect(state.syncedMeetings).toEqual({});
    expect(state.lastSyncAt).toBeUndefined();
  });
});

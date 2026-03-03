import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const GRANOLA_DIR = join(homedir(), ".spoon");
const STATE_FILE = join(GRANOLA_DIR, "sync-state.json");

export interface SyncState {
  /** ISO 8601 timestamp of last successful sync */
  lastSyncAt?: string;
  /** Map of meeting ID → ISO 8601 timestamp when it was last synced */
  syncedMeetings: Record<string, string>;
}

const DEFAULT_STATE: SyncState = {
  lastSyncAt: undefined,
  syncedMeetings: {},
};

/**
 * Load sync state from ~/.spoon/sync-state.json.
 * Returns default state if the file does not exist or is malformed.
 */
export function loadSyncState(): SyncState {
  try {
    if (!existsSync(STATE_FILE)) return { ...DEFAULT_STATE, syncedMeetings: {} };
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      lastSyncAt: parsed.lastSyncAt ?? undefined,
      syncedMeetings: parsed.syncedMeetings ?? {},
    };
  } catch {
    return { ...DEFAULT_STATE, syncedMeetings: {} };
  }
}

/**
 * Persist sync state to ~/.spoon/sync-state.json.
 */
export function saveSyncState(state: SyncState): void {
  if (!existsSync(GRANOLA_DIR)) {
    mkdirSync(GRANOLA_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Return the absolute path to the sync state file.
 */
export function getStateFilePath(): string {
  return STATE_FILE;
}

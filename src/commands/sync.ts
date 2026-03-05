import { Command } from "commander";
import chalk from "chalk";
import cliProgress from "cli-progress";
import { resolve } from "node:path";
import { getMcpClient, closeMcpClient } from "../mcp/client.js";
import type { Meeting, MeetingDetail, TranscriptResult } from "../mcp/types.js";
import { parseDate } from "../utils/dates.js";
import { withRetry, sleep } from "../utils/retry.js";
import { loadSyncState, saveSyncState, type SyncState } from "../sync/state.js";
import {
  getMeetingDir,
  buildFilePrefix,
  writeMeetingFile,
  writeTranscriptFileFromText,
} from "../sync/writer.js";
import { handleError, writeError, EXIT_ERROR } from "../output/errors.js";
import { isTTY } from "../utils/tty.js";

interface SyncOptions {
  since?: string;
  until?: string;
  force?: boolean;
  transcripts?: boolean;
  private?: boolean;
  batchSize?: string;
  delay?: string;
  dryRun?: boolean;
  format?: string;
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync <output-dir>")
    .description("Mirror Granola meeting notes and transcripts to a local directory")
    .option("--since <date>", "Override incremental sync; start from this date")
    .option("--until <date>", "Only sync meetings up to this date")
    .option("--force", "Re-sync all meetings (ignores last-run state)")
    .option("--transcripts", "Also fetch transcripts (warning: very strict rate limit — ~2 calls per 7 min)")
    .option("--no-private", "Exclude private notes from meeting files")
    .option("--batch-size <n>", "IDs per get_meetings call (default: 5)", "5")
    .option("--delay <ms>", "Delay between MCP calls in ms (default: 1000)", "1000")
    .option("--dry-run", "List meetings that would sync, don't write files")
    .option("--format <fmt>", "Progress output format: text, json")
    .addHelpText("after", `
Notes:
  Transcripts are NOT fetched by default — the transcript API has a very tight
  rate limit (~2 calls per 7 minutes). Use --transcripts only for small syncs.

Examples:
  $ spoon sync ./meetings
  $ spoon sync ./meetings --since "last week"
  $ spoon sync ./meetings --since "2025-12-01" --until "2026-01-31"
  $ spoon sync ./meetings --force
  $ spoon sync ./meetings --dry-run
  $ spoon sync ./meetings --transcripts    # fetch transcripts (slow)
  $ spoon sync ~/spoon-backup --batch-size 10`)
    .action(async (outputDirArg: string, options: SyncOptions) => {
      try {
        await runSync(outputDirArg, options);
        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });
}

async function runSync(outputDirArg: string, options: SyncOptions): Promise<void> {
  const outputDir = resolve(outputDirArg);
  const batchSize = parsePosInt(options.batchSize, 5);
  const delayMs = parsePosInt(options.delay, 1000);
  // Transcripts are opt-in: the server enforces ~2 calls per ~7 minute window.
  const includeTranscripts = options.transcripts === true;
  const includePrivate = options.private !== false;
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const useJson = options.format === "json";
  const useTTY = isTTY() && !useJson;

  // 1. Load sync state and determine `since` / `until` dates
  const state = loadSyncState();
  let since: string | undefined;
  let until: string | undefined;

  if (options.since) {
    const parsed = parseDate(options.since);
    if (!parsed) {
      writeError(`Could not parse date: "${options.since}"`, EXIT_ERROR);
      process.exit(EXIT_ERROR);
    }
    since = parsed;
  } else if (!force && state.lastSyncAt) {
    since = state.lastSyncAt;
  }

  if (options.until) {
    const parsed = parseDate(options.until);
    if (!parsed) {
      writeError(`Could not parse date: "${options.until}"`, EXIT_ERROR);
      process.exit(EXIT_ERROR);
    }
    until = parsed;
  }

  if (includeTranscripts) {
    const warn = "⚠  Transcript fetching is enabled. The API allows ~2 transcript calls per ~7 minutes. Expect long pauses.";
    process.stderr.write(chalk.yellow(warn) + "\n");
  }

  const rangeDesc = since && until ? ` from ${since} to ${until}`
    : since ? ` since ${since}`
    : until ? ` until ${until}`
    : " (all time)";
  logLine(useJson, `Syncing meetings${rangeDesc}...`);

  // 2. List meetings
  const client = getMcpClient();
  const allMeetings = await withRetry(
    () => client.listMeetings({ ...(since ? { since } : {}), ...(until ? { until } : {}) }),
  ) as Meeting[];

  // 3. Filter out already-synced meetings (unless --force)
  const meetingsToSync = force
    ? allMeetings
    : allMeetings.filter((m) => !state.syncedMeetings[m.id]);

  if (meetingsToSync.length === 0) {
    logLine(useJson, "No new meetings to sync.");
    return;
  }

  logLine(useJson, `Found ${meetingsToSync.length} meeting(s) to sync.`);

  if (dryRun) {
    printDryRun(meetingsToSync, outputDir, useJson);
    return;
  }

  // 4. Process in batches, with a progress bar in TTY mode
  const updatedSyncedMeetings = { ...state.syncedMeetings };
  let syncedCount = 0;
  const total = meetingsToSync.length;

  // Steps = one per meeting (detail) + one per transcript fetch (if enabled)
  const totalSteps = total * (includeTranscripts ? 2 : 1);

  const bar = useTTY
    ? new cliProgress.SingleBar(
        {
          format: `${chalk.cyan("Syncing")} [{bar}] {percentage}% | {value}/{total} | {currentTitle}`,
          barCompleteChar: "█",
          barIncompleteChar: "░",
          clearOnComplete: false,
          hideCursor: true,
        },
        cliProgress.Presets.shades_classic,
      )
    : null;

  bar?.start(totalSteps, 0, { currentTitle: "starting…" });

  // Track when we last made an MCP call so we can pace every call consistently.
  let lastCallAt = 0;

  async function throttledCall<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const elapsed = now - lastCallAt;
    if (lastCallAt > 0 && elapsed < delayMs) {
      await sleep(delayMs - elapsed);
    }
    lastCallAt = Date.now();
    return fn();
  }

  try {
    for (let i = 0; i < meetingsToSync.length; i += batchSize) {
      const batch = meetingsToSync.slice(i, i + batchSize);
      const batchIds = batch.map((m) => m.id);

      // Fetch full meeting details — throttled before every batch
      const details = await withRetry(
        () => throttledCall(() => client.getMeetings({
          meeting_ids: batchIds,
          include_private_notes: includePrivate,
          include_enhanced_notes: true,
        })),
      ) as MeetingDetail[];

      for (const detail of details) {
        syncedCount++;
        const dir = getMeetingDir(outputDir, detail);
        const meetingPath = writeMeetingFile(dir, detail, { includePrivate });
        const relativePath = meetingPath.replace(outputDir + "/", "");
        const title = detail.title || detail.id;

        bar?.update(syncedCount * (includeTranscripts ? 2 : 1) - (includeTranscripts ? 1 : 0), {
          currentTitle: title,
        });
        logLine(useJson, `[${syncedCount}/${total}] ${title} → ${relativePath}`);

        // Fetch transcript — throttled before every call, same pacing as batch fetches
        if (includeTranscripts) {
          try {
            const transcriptResult = await withRetry(
              () => throttledCall(() => client.getTranscript({ meeting_id: detail.id })),
            ) as TranscriptResult | null;

            if (transcriptResult && transcriptResult.transcript.trim().length > 0) {
              writeTranscriptFileFromText(dir, detail, transcriptResult.transcript);
            }
          } catch (err) {
            // After exhausting retries, reset the throttle clock so the next
            // call waits a full delayMs from now (not from a long time ago).
            lastCallAt = Date.now();
            // Transcript failures should not abort the sync
            const msg = err instanceof Error ? err.message : String(err);
            bar?.stop();
            writeError(
              `Could not fetch transcript for "${title}": ${msg}`,
              EXIT_ERROR,
            );
            bar?.start(totalSteps, syncedCount * 2, { currentTitle: title });
          }

          bar?.update(syncedCount * 2, { currentTitle: title });
        }

        // Mark as synced
        updatedSyncedMeetings[detail.id] = new Date().toISOString();
      }
    }
  } finally {
    bar?.stop();
  }

  // 5. Persist sync state
  const newState: SyncState = {
    lastSyncAt: new Date().toISOString(),
    syncedMeetings: updatedSyncedMeetings,
  };
  saveSyncState(newState);

  const summary = `✓ Synced ${syncedCount} meeting(s) to ${outputDir}`;
  if (useTTY) {
    process.stderr.write(chalk.green(summary) + "\n");
  } else {
    logLine(useJson, summary);
  }
}

// --- Helpers ---

function parsePosInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return !isNaN(n) && n > 0 ? n : fallback;
}

/**
 * Log a progress message. In TTY mode this goes to stderr so it doesn't
 * interfere with the progress bar (which also writes to stderr). In JSON
 * mode it emits a structured line. In non-TTY text mode it just writes
 * the plain message — the bar is suppressed entirely.
 */
function logLine(useJson: boolean, message: string): void {
  if (useJson) {
    process.stderr.write(JSON.stringify({ message }) + "\n");
  } else if (!isTTY()) {
    // Non-TTY, non-JSON: plain text, no bar
    process.stderr.write(message + "\n");
  }
  // In TTY mode the progress bar handles all visual output; individual
  // lines are suppressed to avoid clobbering the bar.
}

function printDryRun(meetings: Meeting[], outputDir: string, useJson: boolean): void {
  if (useJson) {
    const items = meetings.map((m) => ({
      id: m.id,
      title: m.title,
      dir: getMeetingDir(outputDir, m as MeetingDetail),
      file: buildFilePrefix(m as MeetingDetail) + ".md",
    }));
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
  } else {
    for (const m of meetings) {
      const dir = getMeetingDir(outputDir, m as MeetingDetail);
      const prefix = buildFilePrefix(m as MeetingDetail);
      const relativePath = `${dir.replace(outputDir + "/", "")}/${prefix}.md`;
      process.stdout.write(`  ${m.title || m.id} → ${relativePath}\n`);
    }
  }
}


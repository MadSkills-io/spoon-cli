import { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { getMcpClient, closeMcpClient } from "../mcp/client.js";
import type { Meeting, MeetingDetail, TranscriptSegment } from "../mcp/types.js";
import { parseDate } from "../utils/dates.js";
import { withRetry, sleep } from "../utils/retry.js";
import { loadSyncState, saveSyncState, type SyncState } from "../sync/state.js";
import {
  getMeetingDir,
  buildFilePrefix,
  writeMeetingFile,
  writeTranscriptFile,
} from "../sync/writer.js";
import { handleError, writeError, EXIT_ERROR } from "../output/errors.js";
import { isTTY } from "../utils/tty.js";

interface SyncOptions {
  since?: string;
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
    .option("--force", "Re-sync all meetings (ignores last-run state)")
    .option("--no-transcripts", "Skip transcript fetching")
    .option("--no-private", "Exclude private notes from meeting files")
    .option("--batch-size <n>", "IDs per get_meetings call (default: 5)", "5")
    .option("--delay <ms>", "Delay between MCP calls in ms (default: 200)", "200")
    .option("--dry-run", "List meetings that would sync, don't write files")
    .option("--format <fmt>", "Progress output format: text, json")
    .addHelpText("after", `
Examples:
  $ granola sync ./meetings
  $ granola sync ./meetings --since "last week"
  $ granola sync ./meetings --force
  $ granola sync ./meetings --dry-run
  $ granola sync ./meetings --no-transcripts --delay 500
  $ granola sync ~/granola-backup --batch-size 10`)
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
  const delayMs = parsePosInt(options.delay, 200);
  const includeTranscripts = options.transcripts !== false;
  const includePrivate = options.private !== false;
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const useJson = options.format === "json";

  // 1. Load sync state and determine `since` date
  const state = loadSyncState();
  let since: string | undefined;

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

  logProgress(useJson, `Syncing meetings${since ? ` since ${since}` : " (all time)"}...`);

  // 2. List meetings
  const client = getMcpClient();
  const listResult = await withRetry(
    () => client.listMeetings(since ? { since } : {}),
    { baseDelayMs: 1000 },
  );

  const allMeetings = (Array.isArray(listResult) ? listResult : []) as Meeting[];

  // 3. Filter out already-synced meetings (unless --force)
  const meetingsToSync = force
    ? allMeetings
    : allMeetings.filter((m) => !state.syncedMeetings[m.id]);

  if (meetingsToSync.length === 0) {
    logProgress(useJson, "No new meetings to sync.");
    return;
  }

  logProgress(useJson, `Found ${meetingsToSync.length} meeting(s) to sync.`);

  if (dryRun) {
    printDryRun(meetingsToSync, outputDir, useJson);
    return;
  }

  // 4. Process in batches
  const updatedSyncedMeetings = { ...state.syncedMeetings };
  let syncedCount = 0;
  const total = meetingsToSync.length;

  for (let i = 0; i < meetingsToSync.length; i += batchSize) {
    const batch = meetingsToSync.slice(i, i + batchSize);
    const batchIds = batch.map((m) => m.id);

    // Fetch full meeting details
    const detailResult = await withRetry(
      () => client.getMeetings({
        meeting_ids: batchIds,
        include_private_notes: includePrivate,
        include_enhanced_notes: true,
      }),
      { baseDelayMs: 1000 },
    );

    await sleep(delayMs);

    const details = (Array.isArray(detailResult) ? detailResult : []) as MeetingDetail[];

    for (const detail of details) {
      syncedCount++;
      const dir = getMeetingDir(outputDir, detail);
      const meetingPath = writeMeetingFile(dir, detail, { includePrivate });
      const relativePath = meetingPath.replace(outputDir + "/", "");

      logProgress(
        useJson,
        `[${syncedCount}/${total}] ${detail.title || detail.id} → ${relativePath}`,
      );

      // Fetch transcript
      if (includeTranscripts) {
        try {
          const transcriptResult = await withRetry(
            () => client.getTranscript({ meeting_id: detail.id }),
            { baseDelayMs: 1000 },
          );

          await sleep(delayMs);

          const segments = normalizeTranscriptResult(transcriptResult);
          if (segments.length > 0) {
            writeTranscriptFile(dir, detail, segments);
          }
        } catch (err) {
          // Transcript failures should not abort the sync
          const msg = err instanceof Error ? err.message : String(err);
          writeError(
            `Could not fetch transcript for "${detail.title || detail.id}": ${msg}`,
            EXIT_ERROR,
          );
        }
      }

      // Mark as synced
      updatedSyncedMeetings[detail.id] = new Date().toISOString();
    }
  }

  // 5. Persist sync state
  const newState: SyncState = {
    lastSyncAt: new Date().toISOString(),
    syncedMeetings: updatedSyncedMeetings,
  };
  saveSyncState(newState);

  logProgress(useJson, `✓ Synced ${syncedCount} meeting(s) to ${outputDir}`);
}

// --- Helpers ---

function parsePosInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return !isNaN(n) && n > 0 ? n : fallback;
}

function logProgress(useJson: boolean, message: string): void {
  if (useJson) {
    process.stderr.write(JSON.stringify({ message }) + "\n");
  } else {
    if (isTTY()) {
      process.stderr.write(chalk.cyan(message) + "\n");
    } else {
      process.stderr.write(message + "\n");
    }
  }
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

/**
 * Normalize the transcript tool result into an array of TranscriptSegment.
 * The MCP server may return an array directly or wrap it.
 */
function normalizeTranscriptResult(result: unknown): TranscriptSegment[] {
  if (Array.isArray(result)) return result as TranscriptSegment[];
  if (result && typeof result === "object" && "segments" in result) {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r["segments"])) return r["segments"] as TranscriptSegment[];
  }
  return [];
}

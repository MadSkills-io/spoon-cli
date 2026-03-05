import { Command } from "commander";
import { getMcpClient, closeMcpClient } from "../mcp/client.js";
import { parseDate } from "../utils/dates.js";
import { output, resolveFormat } from "../output/formatter.js";
import { handleError, writeError, EXIT_ERROR } from "../output/errors.js";

export function registerMeetingsCommand(program: Command): void {
  const meetings = program
    .command("meetings")
    .description("List, view, and manage Granola meetings");

  // --- meetings list ---
  meetings
    .command("list")
    .description("List meetings from Granola")
    .option("--since <date>", "Show meetings since date (ISO 8601 or natural language)")
    .option("--until <date>", "Show meetings until date (ISO 8601 or natural language)")
    .option("--attendee <name>", "Filter by attendee name or email")
    .option("--folder <name>", "Filter by folder name or ID (client-side)")
    .option("--limit <n>", "Cap the number of results (default: all meetings in range)")
    .option("--format <format>", "Output format: json, table, csv, markdown, text")
    .addHelpText("after", `
Examples:
  $ spoon meetings list
  $ spoon meetings list --since "last week"
  $ spoon meetings list --since 2024-01-01 --until 2024-02-01
  $ spoon meetings list --attendee "Sarah" --limit 5
  $ spoon meetings list --folder "Planning"
  $ spoon meetings list --folder "Planning" --since "last week"
  $ spoon meetings list --format json | jq '.[].title'
  $ spoon meetings list --since "2 days ago" --format csv`)
    .action(async (options: {
      since?: string;
      until?: string;
      attendee?: string;
      folder?: string;
      limit?: string;
      format?: string;
    }) => {
      try {
        const client = getMcpClient();
        const params: Record<string, unknown> = {};

        if (options.since) {
          const parsed = parseDate(options.since);
          if (!parsed) {
            writeError(`Could not parse date: "${options.since}"`, EXIT_ERROR);
            process.exit(EXIT_ERROR);
          }
          params.since = parsed;
        }

        if (options.until) {
          const parsed = parseDate(options.until);
          if (!parsed) {
            writeError(`Could not parse date: "${options.until}"`, EXIT_ERROR);
            process.exit(EXIT_ERROR);
          }
          params.until = parsed;
        }

        if (options.attendee) {
          params.attendee = options.attendee;
        }

        if (options.folder) {
          params.folder = options.folder;
        }

        if (options.limit) {
          const limit = parseInt(options.limit, 10);
          if (!isNaN(limit) && limit > 0) {
            params.limit = limit;
          }
        }

        const result = await client.listMeetings(params);
        const format = resolveFormat(options.format);
        output(result, format);

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });

  // --- meetings get ---
  meetings
    .command("get <id>")
    .description("Get full meeting content by ID")
    .option("--no-private", "Exclude private notes")
    .option("--no-enhanced", "Exclude AI-enhanced notes")
    .option("--format <format>", "Output format: json, table, csv, markdown, text")
    .addHelpText("after", `
Examples:
  $ spoon meetings get abc123
  $ spoon meetings get abc123 --format markdown
  $ spoon meetings get abc123 --no-private --format json`)
    .action(async (id: string, options: {
      private?: boolean;
      enhanced?: boolean;
      format?: string;
    }) => {
      try {
        const client = getMcpClient();

        const result = await client.getMeetings({
          meeting_ids: [id],
          include_private_notes: options.private !== false,
          include_enhanced_notes: options.enhanced !== false,
        });

        const format = resolveFormat(options.format);

        // If we got an array, show the first (and only) item
        if (Array.isArray(result) && result.length === 1) {
          output(result[0], format);
        } else {
          output(result, format);
        }

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });

  // --- meetings transcript ---
  meetings
    .command("transcript <id>")
    .description("Get the raw transcript of a meeting (paid feature)")
    .option("--format <format>", "Output format: json, table, csv, markdown, text")
    .addHelpText("after", `
Examples:
  $ spoon meetings transcript abc123
  $ spoon meetings transcript abc123 --format json
  $ spoon meetings transcript abc123 --format text`)
    .action(async (id: string, options: { format?: string }) => {
      try {
        const client = getMcpClient();

        const result = await client.getTranscript({ meeting_id: id });
        const format = resolveFormat(options.format);
        output(result, format);

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });
}

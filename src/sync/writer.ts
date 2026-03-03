import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MeetingDetail, TranscriptSegment } from "../mcp/types.js";

// Note: TranscriptSegment-based functions are kept for tests.
// New code should use renderTranscriptMarkdownFromText / writeTranscriptFileFromText
// which match the actual server response shape (plain text blob).

/**
 * Convert a title to a URL-safe slug.
 * Lowercase, replace non-alphanumeric with hyphens, collapse runs, trim edges.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Build a filename prefix: YYYY-MM-DD-slugified-title
 * Falls back to the meeting ID when the title is empty.
 */
export function buildFilePrefix(meeting: MeetingDetail): string {
  const dateStr = meeting.start_time
    ? new Date(meeting.start_time).toISOString().slice(0, 10)
    : "undated";
  const slug = meeting.title ? slugify(meeting.title) : meeting.id;
  return `${dateStr}-${slug}`;
}

/**
 * Determine the directory for a meeting based on its folder membership.
 * Meetings with no folder go into `_unfiled/`.
 */
export function getMeetingDir(outputDir: string, meeting: MeetingDetail): string {
  const folders = meeting.folder_membership;
  if (Array.isArray(folders) && folders.length > 0) {
    // Use the first folder as the physical directory name
    const folderName = folders[0].name;
    return join(outputDir, folderName);
  }
  return join(outputDir, "_unfiled");
}

/**
 * Serialize simple data into YAML front-matter (no external YAML dependency).
 */
export function formatFrontMatter(data: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${String(item)}`);
      }
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Render meeting detail as a Markdown string with YAML front-matter.
 */
export function renderMeetingMarkdown(
  meeting: MeetingDetail,
  options: { includePrivate?: boolean } = {},
): string {
  const { includePrivate = true } = options;

  const folders = Array.isArray(meeting.folder_membership)
    ? meeting.folder_membership.map((f) => f.name)
    : [];

  const attendees = Array.isArray(meeting.attendees)
    ? meeting.attendees.map((a) => {
        if (a.name && a.email) return `${a.name} <${a.email}>`;
        return a.name ?? a.email ?? "Unknown";
      })
    : [];

  const frontMatter = formatFrontMatter({
    id: meeting.id,
    title: meeting.title,
    date: meeting.start_time,
    attendees,
    folders,
  });

  const sections: string[] = [frontMatter, ""];

  if (meeting.summary) {
    sections.push("## Summary", "", meeting.summary, "");
  }

  // Prefer enhanced_notes, fall back to notes
  const notes = meeting.enhanced_notes ?? meeting.notes;
  if (notes) {
    sections.push("## Notes", "", notes, "");
  }

  if (includePrivate && meeting.private_notes) {
    sections.push("## Private Notes", "", meeting.private_notes, "");
  }

  return sections.join("\n");
}

/**
 * Format a single timestamp for display in a transcript (HH:MM:SS).
 */
function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(11, 19); // HH:MM:SS
}

/**
 * Render a meeting transcript as Markdown.
 */
export function renderTranscriptMarkdown(
  meeting: MeetingDetail,
  segments: TranscriptSegment[],
): string {
  const frontMatter = formatFrontMatter({
    id: meeting.id,
    title: meeting.title,
    date: meeting.start_time,
  });

  const lines: string[] = [frontMatter, ""];

  for (const seg of segments) {
    const speaker = seg.speaker ?? "Unknown";
    const ts = formatTimestamp(seg.start_time);
    const header = ts ? `**${speaker}** *(${ts})*` : `**${speaker}**`;
    lines.push(header);
    lines.push(seg.text);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Write a meeting detail file to disk.
 * Creates parent directories as needed.
 * Returns the absolute file path.
 */
export function writeMeetingFile(
  dir: string,
  meeting: MeetingDetail,
  options: { includePrivate?: boolean } = {},
): string {
  mkdirSync(dir, { recursive: true });
  const prefix = buildFilePrefix(meeting);
  const filePath = join(dir, `${prefix}.md`);
  const content = renderMeetingMarkdown(meeting, options);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Write a transcript file to disk.
 * Creates parent directories as needed.
 * Returns the absolute file path.
 */
export function writeTranscriptFile(
  dir: string,
  meeting: MeetingDetail,
  segments: TranscriptSegment[],
): string {
  mkdirSync(dir, { recursive: true });
  const prefix = buildFilePrefix(meeting);
  const filePath = join(dir, `${prefix}.transcript.md`);
  const content = renderTranscriptMarkdown(meeting, segments);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Plain-text transcript variants (matches actual server response shape)
// ---------------------------------------------------------------------------

/**
 * Render a meeting transcript from a plain-text blob as Markdown.
 * Used when the API returns a flat string instead of structured segments.
 */
export function renderTranscriptMarkdownFromText(
  meeting: MeetingDetail,
  transcript: string,
): string {
  const frontMatter = formatFrontMatter({
    id:    meeting.id,
    title: meeting.title,
    date:  meeting.start_time,
  });

  return [frontMatter, "", "## Transcript", "", transcript, ""].join("\n");
}

/**
 * Write a plain-text transcript to disk as Markdown.
 * Creates parent directories as needed.
 * Returns the absolute file path.
 */
export function writeTranscriptFileFromText(
  dir: string,
  meeting: MeetingDetail,
  transcript: string,
): string {
  mkdirSync(dir, { recursive: true });
  const prefix   = buildFilePrefix(meeting);
  const filePath = join(dir, `${prefix}.transcript.md`);
  const content  = renderTranscriptMarkdownFromText(meeting, transcript);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

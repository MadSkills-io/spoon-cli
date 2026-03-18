import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import {
  slugify,
  buildFilePrefix,
  getMeetingDir,
  formatFrontMatter,
  renderMeetingMarkdown,
  renderTranscriptMarkdown,
  writeMeetingFile,
  writeTranscriptFile,
  renderTranscriptMarkdownFromText,
  writeTranscriptFileFromText,
} from "../../src/sync/writer.js";
import type { MeetingDetail, TranscriptSegment } from "../../src/mcp/types.js";

const testDir = join(tmpdir(), `granola-writer-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
});

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Q1 Planning Session")).toBe("q1-planning-session");
  });

  it("removes special characters", () => {
    expect(slugify("Meeting: Design & Review!")).toBe("meeting-design-review");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("hello   ---   world")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --Hello World--  ")).toBe("hello-world");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles numbers and mixed case", () => {
    expect(slugify("2024 Q1 Sprint 3")).toBe("2024-q1-sprint-3");
  });
});

describe("buildFilePrefix", () => {
  it("builds YYYY-MM-DD-slug-shortid prefix", () => {
    const meeting = {
      id: "meeting-abc12345",
      title: "Q1 Planning Session",
      start_time: "2024-01-15T09:00:00Z",
    } as MeetingDetail;

    expect(buildFilePrefix(meeting)).toBe("2024-01-15-q1-planning-session-abc12345");
  });

  it("uses 'undated' when start_time is missing", () => {
    const meeting = { id: "meeting-abc12345", title: "Standup" } as MeetingDetail;
    expect(buildFilePrefix(meeting)).toBe("undated-standup-abc12345");
  });

  it("falls back to meeting ID when title is empty", () => {
    const meeting = {
      id: "meeting-xyz",
      title: "",
      start_time: "2024-03-01T10:00:00Z",
    } as MeetingDetail;

    expect(buildFilePrefix(meeting)).toBe("2024-03-01-meeting-xyz-ting-xyz");
  });

  it("disambiguates meetings with same title on same day", () => {
    const meetingA = {
      id: "meeting-aaa11111",
      title: "Standup",
      start_time: "2024-01-15T09:00:00Z",
    } as MeetingDetail;

    const meetingB = {
      id: "meeting-bbb22222",
      title: "Standup",
      start_time: "2024-01-15T14:00:00Z",
    } as MeetingDetail;

    const prefixA = buildFilePrefix(meetingA);
    const prefixB = buildFilePrefix(meetingB);

    expect(prefixA).not.toBe(prefixB);
    expect(prefixA).toBe("2024-01-15-standup-aaa11111");
    expect(prefixB).toBe("2024-01-15-standup-bbb22222");
  });

  it("uses last 8 chars of meeting ID as short suffix", () => {
    const meeting = {
      id: "doc_abcdefghijklmn",
      title: "Review",
      start_time: "2024-06-01T10:00:00Z",
    } as MeetingDetail;

    expect(buildFilePrefix(meeting)).toBe("2024-06-01-review-ghijklmn");
  });
});

describe("getMeetingDir", () => {
  it("returns folder-based directory for meetings with folders", () => {
    const meeting = {
      id: "m1",
      title: "Test",
      folder_membership: [{ id: "fol_abc", name: "Planning", object: "folder" as const }],
    } as MeetingDetail;

    expect(getMeetingDir("/output", meeting)).toBe(join("/output", "Planning"));
  });

  it("returns _unfiled for meetings with no folders", () => {
    const meeting = { id: "m1", title: "Test" } as MeetingDetail;
    expect(getMeetingDir("/output", meeting)).toBe(join("/output", "_unfiled"));
  });

  it("returns _unfiled for empty folder array", () => {
    const meeting = {
      id: "m1",
      title: "Test",
      folder_membership: [],
    } as MeetingDetail;

    expect(getMeetingDir("/output", meeting)).toBe(join("/output", "_unfiled"));
  });

  it("uses the first folder when meeting is in multiple folders", () => {
    const meeting = {
      id: "m1",
      title: "Test",
      folder_membership: [
        { id: "fol_1", name: "Engineering", object: "folder" as const },
        { id: "fol_2", name: "Planning", object: "folder" as const },
      ],
    } as MeetingDetail;

    expect(getMeetingDir("/output", meeting)).toBe(join("/output", "Engineering"));
  });
});

describe("formatFrontMatter", () => {
  it("serializes simple key-value pairs", () => {
    const result = formatFrontMatter({ id: "m1", title: "Test" });
    expect(result).toContain("---");
    expect(result).toContain("id: m1");
    expect(result).toContain("title: Test");
  });

  it("serializes arrays as YAML lists", () => {
    const result = formatFrontMatter({ attendees: ["Alice", "Bob"] });
    expect(result).toContain("attendees:");
    expect(result).toContain("  - Alice");
    expect(result).toContain("  - Bob");
  });

  it("skips undefined and null values", () => {
    const result = formatFrontMatter({ id: "m1", notes: undefined, extra: null });
    expect(result).not.toContain("notes");
    expect(result).not.toContain("extra");
  });

  it("skips empty arrays", () => {
    const result = formatFrontMatter({ folders: [] });
    expect(result).not.toContain("folders");
  });
});

describe("renderMeetingMarkdown", () => {
  const meeting: MeetingDetail = {
    id: "meeting-001",
    title: "Q1 Planning Session",
    start_time: "2024-01-15T09:00:00Z",
    attendees: [
      { name: "Alice Smith", email: "alice@example.com" },
      { name: "Bob Jones" },
    ],
    folder_membership: [{ id: "fol_1", name: "Planning", object: "folder" }],
    summary: "Discussed Q1 goals and milestones.",
    enhanced_notes: "Detailed enhanced notes here.",
    notes: "Regular notes.",
    private_notes: "Private thoughts.",
  };

  it("includes YAML front-matter with meeting metadata", () => {
    const md = renderMeetingMarkdown(meeting);
    expect(md).toContain("---");
    expect(md).toContain("id: meeting-001");
    expect(md).toContain("title: Q1 Planning Session");
    expect(md).toContain("date: 2024-01-15T09:00:00Z");
    expect(md).toContain("  - Alice Smith <alice@example.com>");
    expect(md).toContain("  - Bob Jones");
    expect(md).toContain("  - Planning");
  });

  it("includes summary section", () => {
    const md = renderMeetingMarkdown(meeting);
    expect(md).toContain("## Summary");
    expect(md).toContain("Discussed Q1 goals and milestones.");
  });

  it("prefers enhanced_notes over notes", () => {
    const md = renderMeetingMarkdown(meeting);
    expect(md).toContain("## Notes");
    expect(md).toContain("Detailed enhanced notes here.");
    expect(md).not.toContain("Regular notes.");
  });

  it("falls back to notes when enhanced_notes is absent", () => {
    const meetingWithoutEnhanced = { ...meeting, enhanced_notes: undefined };
    const md = renderMeetingMarkdown(meetingWithoutEnhanced);
    expect(md).toContain("Regular notes.");
  });

  it("includes private notes by default", () => {
    const md = renderMeetingMarkdown(meeting);
    expect(md).toContain("## Private Notes");
    expect(md).toContain("Private thoughts.");
  });

  it("excludes private notes when includePrivate is false", () => {
    const md = renderMeetingMarkdown(meeting, { includePrivate: false });
    expect(md).not.toContain("## Private Notes");
    expect(md).not.toContain("Private thoughts.");
  });
});

describe("renderTranscriptMarkdown", () => {
  const meeting: MeetingDetail = {
    id: "meeting-001",
    title: "Q1 Planning Session",
    start_time: "2024-01-15T09:00:00Z",
  };

  const segments: TranscriptSegment[] = [
    { speaker: "Alice Smith", text: "Let's get started.", start_time: "2024-01-15T09:00:01Z" },
    { speaker: "Bob Jones", text: "Sounds good.", start_time: "2024-01-15T09:00:05Z" },
  ];

  it("includes YAML front-matter", () => {
    const md = renderTranscriptMarkdown(meeting, segments);
    expect(md).toContain("---");
    expect(md).toContain("id: meeting-001");
    expect(md).toContain("title: Q1 Planning Session");
  });

  it("renders speaker names in bold", () => {
    const md = renderTranscriptMarkdown(meeting, segments);
    expect(md).toContain("**Alice Smith**");
    expect(md).toContain("**Bob Jones**");
  });

  it("renders timestamps in HH:MM:SS format", () => {
    const md = renderTranscriptMarkdown(meeting, segments);
    expect(md).toContain("*(09:00:01)*");
    expect(md).toContain("*(09:00:05)*");
  });

  it("renders segment text", () => {
    const md = renderTranscriptMarkdown(meeting, segments);
    expect(md).toContain("Let's get started.");
    expect(md).toContain("Sounds good.");
  });

  it("handles missing speaker as Unknown", () => {
    const noSpeaker: TranscriptSegment[] = [
      { text: "Hello.", start_time: "2024-01-15T09:00:00Z" },
    ];
    const md = renderTranscriptMarkdown(meeting, noSpeaker);
    expect(md).toContain("**Unknown**");
  });

  it("handles missing timestamp gracefully", () => {
    const noTime: TranscriptSegment[] = [
      { speaker: "Alice", text: "Hello." },
    ];
    const md = renderTranscriptMarkdown(meeting, noTime);
    expect(md).toContain("**Alice**");
    expect(md).not.toContain("*()*");
  });
});

describe("writeMeetingFile", () => {
  it("writes a .md file and returns the path", () => {
    const meeting: MeetingDetail = {
      id: "meeting-abc12345",
      title: "Standup",
      start_time: "2024-01-16T10:00:00Z",
      summary: "Daily standup meeting.",
    };

    const outputDir = join(testDir, "output", "_unfiled");
    const filePath = writeMeetingFile(outputDir, meeting);

    expect(filePath).toContain("2024-01-16-standup-abc12345.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("id: meeting-abc12345");
    expect(content).toContain("Daily standup meeting.");
  });

  it("creates parent directories recursively", () => {
    const meeting: MeetingDetail = {
      id: "meeting-def67890",
      title: "Deep Nested",
      start_time: "2024-02-01T10:00:00Z",
    };

    const deepDir = join(testDir, "a", "b", "c");
    const filePath = writeMeetingFile(deepDir, meeting);
    expect(existsSync(filePath)).toBe(true);
  });
});

describe("writeTranscriptFile", () => {
  it("writes a .transcript.md file and returns the path", () => {
    const meeting: MeetingDetail = {
      id: "meeting-abc12345",
      title: "Standup",
      start_time: "2024-01-16T10:00:00Z",
    };

    const segments: TranscriptSegment[] = [
      { speaker: "Alice", text: "Hello.", start_time: "2024-01-16T10:00:01Z" },
    ];

    const outputDir = join(testDir, "transcripts");
    const filePath = writeTranscriptFile(outputDir, meeting, segments);

    expect(filePath).toContain("2024-01-16-standup-abc12345.transcript.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("**Alice**");
    expect(content).toContain("Hello.");
  });
});

// ---------------------------------------------------------------------------
// Plain-text transcript variants (match actual server response shape)
// ---------------------------------------------------------------------------

describe("renderTranscriptMarkdownFromText", () => {
  const meeting: MeetingDetail = {
    id: "meeting-001",
    title: "Q1 Planning Session",
    start_time: "2024-01-15T09:00:00Z",
  };

  it("includes YAML front-matter with id and title", () => {
    const md = renderTranscriptMarkdownFromText(meeting, "Alice: Hello.");
    expect(md).toContain("---");
    expect(md).toContain("id: meeting-001");
    expect(md).toContain("title: Q1 Planning Session");
  });

  it("includes a ## Transcript heading", () => {
    const md = renderTranscriptMarkdownFromText(meeting, "some text");
    expect(md).toContain("## Transcript");
  });

  it("includes the transcript text verbatim", () => {
    const transcript = "Alice: Hello.\nBob: Hi there.";
    const md = renderTranscriptMarkdownFromText(meeting, transcript);
    expect(md).toContain("Alice: Hello.");
    expect(md).toContain("Bob: Hi there.");
  });

  it("handles an empty transcript string", () => {
    const md = renderTranscriptMarkdownFromText(meeting, "");
    expect(md).toContain("## Transcript");
  });
});

describe("writeTranscriptFileFromText", () => {
  it("writes a .transcript.md file and returns the correct path", () => {
    const meeting: MeetingDetail = {
      id: "meeting-abc12345",
      title: "Standup",
      start_time: "2024-01-16T10:00:00Z",
    };

    const outputDir = join(testDir, "text-transcripts");
    const filePath = writeTranscriptFileFromText(outputDir, meeting, "Hello world.");

    expect(filePath).toContain("2024-01-16-standup-abc12345.transcript.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Hello world.");
    expect(content).toContain("## Transcript");
  });

  it("creates parent directories recursively", () => {
    const meeting: MeetingDetail = {
      id: "meeting-def67890",
      title: "Deep Nested",
      start_time: "2024-02-01T10:00:00Z",
    };

    const deepDir = join(testDir, "x", "y", "z");
    const filePath = writeTranscriptFileFromText(deepDir, meeting, "text");
    expect(existsSync(filePath)).toBe(true);
  });

  it("includes id in front-matter", () => {
    const meeting: MeetingDetail = {
      id: "abc-12345678",
      title: "Test",
      start_time: "2024-03-01T08:00:00Z",
    };

    const filePath = writeTranscriptFileFromText(testDir, meeting, "content");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("id: abc-12345678");
  });
});

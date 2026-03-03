# Changelog

All notable changes to `spoon-cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.1] — 2026-03-03

### Fixed
- **`meetings list`**, **`meetings get`**, and **`sync`** now correctly parse the XML response format returned by the Granola MCP server (it never returned JSON for these tools — this was the root cause of all three being broken)
- **`--since`**, **`--until`**, and **`--limit`** filters are now applied client-side after XML parsing; the server ignores these parameters but our parsing and filtering works correctly
- **`sync`** now correctly writes meeting files — previously `listMeetings()` returned a string instead of `Meeting[]`, causing sync to always report "No new meetings to sync"
- **`meetings get`** now renders structured markdown with attendees, notes, and summary instead of displaying a raw XML blob
- Attendee parsing handles all known formats: `Name (note creator) from Company <email>`, `Name from Company <email>`, `Name <email>`
- `"No summary"` placeholder returned by the API for meetings without notes is suppressed rather than written to the file
- **`sync` transcript handling** updated to match the actual `get_meeting_transcript` response shape (`{id, title, transcript: string}` flat object rather than `TranscriptSegment[]`)
- Fixed stale `granola auth login` reference in 401 error message (now `spoon auth login`)
- Updated MCP client name from `granola-cli` to `spoon-cli` in connection handshake

### Added
- XML parsing helpers: `parseXmlMeetings`, `parseXmlMeetingDetail`, `parseAttendees`, `parseApiDate`, `extractAttr`, `decodeXmlEntities`
- `TranscriptResult` type in `src/mcp/types.ts` matching actual server response
- `renderTranscriptMarkdownFromText` / `writeTranscriptFileFromText` in `src/sync/writer.ts` for plain-text transcript blobs
- Warning emitted when `--folder` is used (folder data is absent from API responses so filtering cannot work)
- 7 new tests covering new writer paths; mock server updated to return XML matching real server format

---

## [0.2.0] — 2026-03-03

### Added
- Progress bar for `spoon sync` using `cli-progress` (TTY mode only; falls back to plain text when piped)
- `CHANGELOG.md` added to published npm package

### Changed
- `spoon sync` no longer prints one line per meeting in TTY mode — the progress bar replaces per-meeting log lines, keeping the terminal clean during large syncs

---

## [0.1.1] — 2026-03-03

### Changed
- Config and credential directory changed from `~/.granola/` to `~/.spoon/`

---

## [0.1.0] — 2026-03-03

Initial release.

### Added
- `spoon auth login|logout|status` — OAuth 2.1 + PKCE + Dynamic Client Registration flow
- `spoon meetings list` — list meetings with `--since`, `--until`, `--attendee`, `--folder`, `--limit` filters
- `spoon meetings get <id>` — fetch full meeting content including notes and AI-enhanced notes
- `spoon meetings transcript <id>` — fetch raw transcript (paid feature)
- `spoon query "<question>"` — natural language search across all meetings
- `spoon sync <output-dir>` — incremental mirror of meetings and transcripts to local Markdown files with YAML front-matter; mirrors Granola folder structure as subdirectories
- `spoon config` — display current configuration and file paths
- Auto-detection of output format: human-readable tables/text in TTY, JSON when piped
- `--format` flag to override auto-detection on any command
- `GRANOLA_TOKEN` env var for headless / CI use (skips OAuth)
- Exponential-backoff retry on rate-limited MCP calls (`withRetry()`)
- Incremental sync state persisted at `~/.spoon/sync-state.json`

[Unreleased]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/MadSkills-io/spoon-cli/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/MadSkills-io/spoon-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MadSkills-io/spoon-cli/releases/tag/v0.1.0

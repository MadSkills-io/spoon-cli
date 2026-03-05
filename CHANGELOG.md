# Changelog

All notable changes to `spoon-cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.5] — 2026-03-04

### Fixed
- **`--since` / `--until` now actually work** — the `list_meetings` API schema changed to use a `time_range` enum (`this_week` | `last_week` | `last_30_days` | `custom`) with `custom_start` / `custom_end` ISO date params (`additionalProperties: false`). Our previous code sent unknown parameters that the server silently ignored, always returning the default last-30-days window. Now `--since` maps to `time_range: "custom"` with the correct `custom_start` / `custom_end` fields.
- **`--limit` no longer defaults to 20** — the default was silently truncating results to 20, making it appear that only recent meetings existed. `--limit` is now opt-in; omitting it returns all meetings in the requested range.

### Changed
- Default `spoon meetings list` (no flags) returns the server's `last_30_days` window (up to ~64 meetings).
- `spoon meetings list --since <date>` uses the server's `custom` range — returns all meetings back to the earliest data the server holds (~Dec 2025).
- `--limit <n>` is applied client-side after the server response and caps to the N most recent meetings.

---

## [0.2.4] — 2026-03-03

### Fixed
- **Auth broken** — Granola's auth server migrated from `mcp.granola.ai` to `mcp-auth.granola.ai`. The cached `client.json` contained a `client_id` registered against the old server, causing "invalid redirect URI" errors on login.
- **Stale client registration detection** — `registerClient()` now stores the issuer URL alongside the `client_id` in `~/.spoon/client.json`. On each login, if the discovered issuer doesn't match the stored one, the stale registration is discarded and a fresh DCR is performed against the current auth server. This prevents silent breakage if the auth server moves again.
- Fixed stale `granola auth login` error message → `spoon auth login`.

### Immediate fix
If you see "invalid redirect URI" on login, delete `~/.spoon/client.json` and run `spoon auth login` again. Future logins will re-register automatically when the auth server changes.

---

## [0.2.3] — 2026-03-03

### Fixed
- **`sync` transcript rate limiting** — end-to-end testing revealed the transcript API enforces a hard limit of approximately **2 calls per 7-minute window** regardless of delay. This is a server-side quota, not a rate per second, so no amount of inter-call delay prevents exhaustion during a sync of more than 2 meetings.

### Changed
- **`--transcripts` is now opt-in** (previously `--no-transcripts` was required to skip). Transcripts are no longer fetched by default. Pass `--transcripts` to enable, and expect a warning about the rate limit.
- **`withRetry` default base delay raised from 1s → 10s**, giving a backoff sequence of 10s → 20s → 40s → 80s instead of 1s → 2s → 4s → 8s. The previous sequence was too short to survive the server's actual rate limit window.
- **Throttle clock is wall-clock based** (`throttledCall`): delay is measured from when the last call *completed*, not when it was *issued*, ensuring the full `delayMs` gap is always respected regardless of how long the call took.
- Retry log messages now show seconds (`10s`) instead of milliseconds (`10000ms`).

---

## [0.2.2] — 2026-03-03

### Fixed
- **`meetings list` table** no longer line-wraps on narrow terminals. Terminals narrower than 100 columns now render a compact card-style layout (title, date, attendees, id — one meeting per card). Wider terminals keep the table layout with column widths distributed proportionally to the available width instead of being unconstrained.
- **`sync` rate limiting** — delay is now applied *before* each MCP call (proactive throttling) rather than after batch fetches (reactive). Default delay raised from 200 ms to 1000 ms to stay comfortably ahead of the server's rate limit.

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

[Unreleased]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/MadSkills-io/spoon-cli/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/MadSkills-io/spoon-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MadSkills-io/spoon-cli/releases/tag/v0.1.0

# Changelog

All notable changes to `spoon-cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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

[Unreleased]: https://github.com/MadSkills-io/spoon-cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MadSkills-io/spoon-cli/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/MadSkills-io/spoon-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MadSkills-io/spoon-cli/releases/tag/v0.1.0

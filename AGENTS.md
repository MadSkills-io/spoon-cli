# spoon — AI Agent Conventions

> **Standing instruction:** Keep this file and `README.md` up to date whenever you make changes to the project. `CLAUDE.md` is for agent context; `README.md` is for end-user documentation. Both must stay accurate after every change.

---

## Project Overview

`spoon` (`spoon-cli`) is an unofficial CLI tool to consume your Granola — it queries and syncs [Granola](https://granola.ai) AI meeting notes via Granola's public MCP server (`https://mcp.granola.ai/mcp`). The binary is named `spoon`; the npm package is `spoon-cli`.

- **npm:** `npm install -g spoon-cli`
- **Repo:** `https://github.com/MadSkills-io/spoon-cli`
- **Current version:** `0.2.3`

---

## Tech Stack

- **Language:** TypeScript (ESM, Node.js 20+)
- **MCP Client:** `@modelcontextprotocol/sdk` (StreamableHTTPClientTransport)
- **CLI Framework:** `commander` (subcommand pattern)
- **Progress bar:** `cli-progress` (TTY only in `sync` command)
- **Build:** `tsup` (esbuild-based)
- **Tests:** `vitest`
- **Package Manager:** `pnpm`

---

## Architecture

Four layers: CLI → Service → MCP Client → Auth. Each layer has a single responsibility.

---

## Conventions

- All source in `src/`, tests in `tests/`
- ESM only (`"type": "module"` in package.json)
- Strict TypeScript (`strict: true`)
- Error output always goes to stderr; data output to stdout
- Exit codes: 0=success, 1=general error, 2=auth error, 3=rate limited, 4=not found
- JSON output when piped (non-TTY); human-readable when interactive (TTY)
- `--format` flag always overrides auto-detection
- Progress-heavy commands (e.g. `sync`) use `cli-progress` in TTY mode; suppress per-item log lines in that mode to avoid clobbering the bar; fall back to plain-text lines when non-TTY or `--format json`
- Config and credential directory: `~/.spoon/`
- `GRANOLA_TOKEN` env var bypasses OAuth (kept as-is — it's the upstream token name)

---

## Commands

```
spoon auth login|logout|status
spoon meetings list [--since] [--until] [--attendee] [--folder] [--limit] [--format]
spoon meetings get <id> [--no-private] [--no-enhanced] [--format]
spoon meetings transcript <id> [--format]
spoon query "<question>" [--format]
spoon sync <output-dir> [--since] [--force] [--transcripts] [--no-private] [--batch-size] [--delay] [--dry-run] [--format]
  # --transcripts is OPT-IN: API allows ~2 calls per ~7 min window
spoon config [--format]
```

---

## Key Files

- `src/index.ts` — CLI entry point; registers all subcommands
- `src/mcp/client.ts` — MCP SDK wrapper; singleton `getMcpClient()`; handles 401 refresh; XML parser for list/get responses
- `src/mcp/types.ts` — shared TypeScript interfaces (Meeting, MeetingDetail, TranscriptResult, etc.)
- `src/auth/oauth.ts` — OAuth 2.1 + PKCE + DCR flow
- `src/auth/token-store.ts` — credential persistence (`~/.spoon/`)
- `src/commands/auth.ts` — auth command
- `src/commands/meetings.ts` — meetings list/get/transcript commands
- `src/commands/query.ts` — query command
- `src/commands/sync.ts` — sync command (progress bar, batching, wall-clock throttle, retry, state)
- `src/sync/state.ts` — load/save `~/.spoon/sync-state.json`
- `src/sync/writer.ts` — slugify, getMeetingDir, writeMeetingFile, writeTranscriptFileFromText
- `src/utils/retry.ts` — `withRetry()` exponential-backoff (default base 10s → 10s/20s/40s/80s, max 4 attempts)
- `src/utils/config.ts` — `GranolaConfig` load/save (`~/.spoon/config.json`)
- `src/utils/dates.ts` — `parseDate()` (ISO 8601 + natural language via chrono-node)
- `src/utils/tty.ts` — `isTTY()`, `isColorSupported()`, `defaultFormat()`
- `src/output/formatter.ts` — `output()` dispatch (json/table/csv/markdown/text); responsive table (compact card layout < 100 cols)
- `src/output/errors.ts` — `writeError()`, `handleError()`, exit codes
- `scripts/characterize-api.mjs` — rate limit characterization script (run before writing throttling code)
- `CHANGELOG.md` — Keep a Changelog format; update on every version bump

---

## Data Directory (`~/.spoon/`)

```
~/.spoon/
├── credentials.json   # Access + refresh tokens (chmod 0600)
├── client.json        # OAuth client registration (cached)
├── config.json        # CLI preferences (defaultFormat, defaultLimit, mcpUrl)
├── discovery.json     # OAuth server metadata (cached)
└── sync-state.json    # lastSyncAt + syncedMeetings map (id → synced_at)
```

---

## Known API Behaviour & Quirks

These were discovered through live testing. Characterize again if symptoms change
(`node scripts/characterize-api.mjs`).

### Response formats
- `list_meetings` → returns **XML text**, not JSON. Parsed by `parseXmlMeetings()` in `client.ts`.
- `get_meetings` → returns **XML text**, not JSON. Parsed by `parseXmlMeetingDetail()`.
- `get_meeting_transcript` → returns **JSON** `{id, title, transcript: string}` (flat text blob, not segments).
- `query_granola_meetings` → returns JSON `{answer, sources}`.

### Filtering
- `list_meetings` accepts `time_range` enum: `this_week` | `last_week` | `last_30_days` | `custom` (default: `last_30_days`).
- Custom range uses `custom_start` + `custom_end` (ISO date strings: `YYYY-MM-DD`).
- The server's `additionalProperties: false` means unknown params (e.g. `since`, `start_date`) are silently ignored — always use the documented schema.
- `--since` / `--until` in our CLI map to `time_range: "custom"` + `custom_start` / `custom_end` sent to the server.
- `--limit` is applied client-side (no server param).
- `--attendee` is honoured server-side.
- `folder_membership` is **not present** in XML responses — `--folder` filtering cannot work and warns the user.
- Earliest data the server returns appears to be ~Dec 2025 regardless of `custom_start`.

### Rate limits (measured 2026-03-03)
| Endpoint | Limit |
|---|---|
| `list_meetings` | No limit detected in normal use |
| `get_meetings` | No limit detected in normal use |
| `get_meeting_transcript` | **~2 calls per ~7 minute window** (hard burst quota) |

**Implications:**
- Transcript fetching is **opt-in** (`--transcripts` flag) and off by default in `sync`.
- No inter-call delay can prevent exhaustion for syncs of more than ~2 meetings with transcripts.
- After exhausting the transcript quota, the window clears in ~7 minutes.
- **Before writing any new throttling or retry logic, run the characterization script.**

### MCP transport
- The server requires `Accept: application/json, text/event-stream` — responses may be SSE (`data: {...}\n\n`) not plain JSON.
- Session ID is returned in the `Mcp-Session-Id` response header and must be sent on subsequent requests.

---

## Testing

- Unit + integration tests in `tests/`
- Mock MCP server: `tests/mcp/mock-server.ts` — returns XML from list/get_meetings, flat JSON from get_meeting_transcript (matches real server)
- Mock `homedir()` with `vi.mock("node:os", ...)` and temp dirs for state/token tests
- Run: `pnpm test` or `pnpm test:coverage`

---

## Build & Run

```bash
pnpm install
pnpm build
node dist/index.js --help
# or: pnpm link --global && spoon --help
```

---

## Versioning & Publishing

- Lockfile (`pnpm-lock.yaml`) is committed — this is an app, not a library
- Version bumps: `npm version patch|minor|major --force` (the `--force` is needed because `.claude/settings.local.json` is gitignored but leaves the working tree dirty)
- Publish: `npm publish --access public --otp=<code>`
- After every version bump: update `CHANGELOG.md` before publishing

---

## Lessons Learned (for future sessions)

### Always characterize the API before writing throttling code
Run `node scripts/characterize-api.mjs` before implementing any rate limit handling.
Reasoning alone about delays is insufficient — the actual constraint may be a burst quota (N calls per window) rather than a rate (calls/second), requiring a completely different strategy.

### Test end-to-end early, not last
Mock tests catch regressions; only live API tests reveal what the server actually returns.
The XML response format and transcript quota were both only discoverable through live testing.

### Design features around API constraints from the start
When two endpoints have different rate limit profiles, the CLI should expose them separately rather than papering over differences with a shared delay. The sync command's `--transcripts` opt-in design came from this lesson.

### Treat quota exhaustion as a fatal condition for that feature, not a retry loop
After all retries fail on a quota error, stop that feature and tell the user clearly ("transcript quota exhausted — re-run after ~7 minutes"). Silently continuing and writing 0 transcripts while logging errors is confusing.

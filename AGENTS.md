# spoon — AI Agent Conventions

> **Standing instruction:** Keep this file and `README.md` up to date whenever you make changes to the project. `CLAUDE.md` is for agent context; `README.md` is for end-user documentation. Both must stay accurate after every change.

---

## Project Overview

`spoon` (`spoon-cli`) is an unofficial CLI tool to consume your Granola — it queries and syncs [Granola](https://granola.ai) AI meeting notes via Granola's public MCP server (`https://mcp.granola.ai/mcp`). The binary is named `spoon`; the npm package is `spoon-cli`.

- **npm:** `npm install -g spoon-cli`
- **Repo:** `https://github.com/MadSkills-io/spoon-cli`
- **Current version:** `0.2.0`

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
spoon sync <output-dir> [--since] [--force] [--no-transcripts] [--no-private] [--batch-size] [--delay] [--dry-run] [--format]
spoon config [--format]
```

---

## Key Files

- `src/index.ts` — CLI entry point; registers all subcommands
- `src/mcp/client.ts` — MCP SDK wrapper; singleton `getMcpClient()`; handles 401 refresh
- `src/mcp/types.ts` — shared TypeScript interfaces (Meeting, MeetingDetail, TranscriptSegment, etc.)
- `src/auth/oauth.ts` — OAuth 2.1 + PKCE + DCR flow
- `src/auth/token-store.ts` — credential persistence (`~/.spoon/`)
- `src/commands/auth.ts` — auth command
- `src/commands/meetings.ts` — meetings list/get/transcript commands
- `src/commands/query.ts` — query command
- `src/commands/sync.ts` — sync command (progress bar, batching, retry, state)
- `src/sync/state.ts` — load/save `~/.spoon/sync-state.json`
- `src/sync/writer.ts` — slugify, getMeetingDir, writeMeetingFile, writeTranscriptFile
- `src/utils/retry.ts` — `withRetry()` exponential-backoff (1 s→2 s→4 s→8 s, max 4 attempts)
- `src/utils/config.ts` — `GranolaConfig` load/save (`~/.spoon/config.json`)
- `src/utils/dates.ts` — `parseDate()` (ISO 8601 + natural language via chrono-node)
- `src/utils/tty.ts` — `isTTY()`, `isColorSupported()`, `defaultFormat()`
- `src/output/formatter.ts` — `output()` dispatch (json/table/csv/markdown/text)
- `src/output/errors.ts` — `writeError()`, `handleError()`, exit codes
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

## Testing

- Unit + integration tests in `tests/`
- Mock MCP server: `tests/mcp/mock-server.ts`
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

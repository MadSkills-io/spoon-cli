# Implementation Phases

## Overview

The implementation is organized into four phases that build on each other incrementally. Each phase ends with a concrete, testable milestone. Phases 1–3 deliver a complete, publishable CLI; Phase 4 covers advanced features that can be added iteratively post-launch.

**Estimated timeline:** Phase 1: 3–4 days | Phase 2: 2–3 days | Phase 3: 2–3 days | Phase 4: ongoing

---

## Phase 1 — Foundation

**Goal:** Establish the project skeleton and get end-to-end authentication + raw tool invocation working.

**Milestone:** `granola auth login` succeeds, and `granola meetings list` returns raw JSON from the live MCP server.

---

### 1.1 Project Scaffolding

**Tasks:**
- [ ] Initialize `pnpm` workspace: `pnpm init`
- [ ] Install all production and dev dependencies (see `package.json` in `06-project-structure.md`)
- [ ] Configure `tsconfig.json` with strict TypeScript settings, ESM output
- [ ] Configure `tsup.config.ts` with shebang banner, `keytar` as external
- [ ] Configure `vitest.config.ts` with coverage thresholds
- [ ] Set up ESLint with TypeScript plugin (`@typescript-eslint/recommended`)
- [ ] Create `AGENTS.md` with project conventions (symlink as `CLAUDE.md`)
- [ ] Create `src/index.ts` skeleton: commander setup, `--version`, `--help`
- [ ] Verify `pnpm build` produces `dist/index.js` with shebang
- [ ] Verify `node dist/index.js --help` prints usage

**Acceptance criteria:**
- `pnpm build` exits 0
- `pnpm test` exits 0 (no tests yet, but runner must work)
- `node dist/index.js --version` prints version string
- `node dist/index.js --help` prints usage text

---

### 1.2 PKCE Module

**Tasks:**
- [ ] Implement `src/auth/pkce.ts`:
  - `generateVerifier()` — 96 random bytes, base64url encoded
  - `generateChallenge(verifier)` — SHA-256, base64url encoded
- [ ] Write `tests/auth/pkce.test.ts`:
  - Verifier is 128 characters long (96 bytes base64url)
  - Verifier uses only URL-safe characters (`A-Za-z0-9-_`)
  - Challenge is 43 characters long (32 bytes SHA-256, base64url)
  - `generateChallenge(generateVerifier())` never throws
  - Two calls to `generateVerifier()` produce different results (random)

**Acceptance criteria:**
- `pnpm test tests/auth/pkce.test.ts` passes

---

### 1.3 OAuth Discovery and DCR

**Tasks:**
- [ ] Implement `discoverEndpoints()` in `src/auth/oauth.ts`:
  - `GET /.well-known/oauth-authorization-server` on the MCP server base URL
  - Return parsed JSON on 200
  - Return hardcoded defaults if 404 or network error
- [ ] Implement `registerClient()`:
  - `POST /register` with client metadata
  - Parse and return `client_id`
  - Cache result in `~/.granola/client.json`
  - Read from cache if file exists and is <30 days old
- [ ] Write `tests/auth/oauth.test.ts` (mocked fetch):
  - Discovery returns parsed metadata when server responds 200
  - Discovery returns defaults when server responds 404
  - DCR caches `client_id` to file
  - DCR reads from cache on subsequent calls

**Acceptance criteria:**
- Tests pass with mocked HTTP (no live server dependency)

---

### 1.4 OAuth Callback Server

**Tasks:**
- [ ] Implement `src/auth/callback-server.ts`:
  - Start HTTP server on port 0 (OS-assigned random port)
  - Return `{ port, waitForCallback }` once listening
  - `waitForCallback()` resolves with `{ code, state }` on redirect receipt
  - Validate `state` parameter; reject mismatches
  - Return success HTML page to browser
  - Reject if not `/callback` path
  - Implement 120s timeout: reject promise with `TimeoutError`
  - Ensure server is closed after callback or timeout
- [ ] Write unit tests:
  - Server starts and reports its port
  - Simulating a GET to `/callback?code=X&state=Y` resolves promise
  - State mismatch rejects promise
  - Timeout rejects after configured duration (use short timeout in tests)

**Acceptance criteria:**
- Tests pass; no open handles after test completes

---

### 1.5 Full Login Flow Orchestration

**Tasks:**
- [ ] Implement `login()` function in `src/auth/oauth.ts`:
  - Call `discoverEndpoints()`
  - Call `registerClient()` (or read from cache)
  - Generate PKCE verifier + challenge
  - Start callback server
  - Generate `state` nonce
  - Build authorization URL
  - Open browser with `open` package
  - Print fallback URL to console
  - Await callback (code + state)
  - Exchange code for tokens via `POST /token`
  - Store tokens via `storeCredentials()`
  - Return user info
- [ ] Handle all error paths:
  - Browser open failure: print URL, wait for manual visit
  - Callback timeout: print clear error message
  - Token exchange failure: print status code + response body

**Acceptance criteria:**
- Manual test: `node dist/index.js auth login` opens browser, completes flow, stores token

---

### 1.6 Token Store

**Tasks:**
- [ ] Implement `src/auth/token-store.ts`:
  - `storeCredentials(creds)`: try keytar first; fall back to file with 0600 perms
  - `loadCredentials()`: try keytar; fall back to file; return null if neither
  - `clearCredentials()`: delete from keytar + file (both, idempotently)
  - `getValidToken(opts?)`: load credentials; check 5-min expiry window; refresh if needed; throw `AuthError` if no credentials
- [ ] Write `tests/auth/token-store.test.ts`:
  - Mock keytar module
  - Test store → load round-trip via keytar
  - Test fallback to file when keytar throws
  - Test `getValidToken` refreshes when token expires within 5 minutes
  - Test `getValidToken` throws `AuthError` when no credentials exist

**Acceptance criteria:**
- Tests pass with mocked keytar and mocked filesystem

---

### 1.7 MCP Client Wrapper

**Tasks:**
- [ ] Implement `src/mcp/client.ts` — `McpClient` class:
  - Lazy initialization on first `callTool()` call
  - Auth header injection via `StreamableHTTPClientTransport`
  - `callTool(name, args, opts?)` with timeout support
  - Error recovery: 401 → refresh → retry once
  - Error recovery: 404 with session → re-initialize → retry
  - Error recovery: 429 → parse `Retry-After` → backoff → retry max 3
  - Error recovery: 5xx → exponential backoff (1s, 2s, 4s) → retry max 3
  - `extractContent(result)` helper: parse `content[0].text` as JSON
- [ ] Define `src/mcp/types.ts` interfaces
- [ ] Write integration tests using `tests/mcp/mock-server.ts`:
  - Successful `callTool` returns parsed JSON
  - 401 triggers refresh and retry
  - 429 triggers backoff and retry
  - Timeout rejects with `TimeoutError`

**Acceptance criteria:**
- Tests pass against mock server
- Manual test: `McpClient` connects to live `mcp.granola.ai` with valid token

---

### 1.8 Auth Commands

**Tasks:**
- [ ] Implement `src/commands/auth.ts`:
  - `auth login`: call `login()`, print success message with user info
  - `auth logout`: call `revokeToken()` + `clearCredentials()`, print confirmation
  - `auth status`: call `loadCredentials()`, format and print status
- [ ] Register auth commands in `src/index.ts`

**Acceptance criteria:**
- `granola auth login` — completes browser flow, prints success
- `granola auth logout` — prints confirmation, token file/keychain cleared
- `granola auth status` — shows authenticated state
- `granola auth status` (not logged in) — shows unauthenticated state, exits 2

---

### 1.9 Wire `meetings list` (Raw)

**Tasks:**
- [ ] Add minimal `src/commands/meetings.ts` with `meetings list` (no formatting, raw JSON output)
- [ ] Register in `src/index.ts`

**Phase 1 Milestone check:**
- [ ] `granola auth login` → browser opens → authentication completes → token stored ✓
- [ ] `granola meetings list` → JSON array of meetings printed ✓

---

## Phase 2 — Core Commands

**Goal:** All four MCP tools accessible via CLI with polished, context-appropriate output formatting.

**Milestone:** All commands work; output is polished in both TTY (table/text) and piped (JSON) modes.

---

### 2.1 Output Formatter

**Tasks:**
- [ ] Implement `src/output/formatter.ts`:
  - `detectDefaultFormat(command)` — TTY detection per command type
  - `formatMeetingsList(meetings, opts)` — json / table / csv / markdown
  - `formatMeetingDetail(meeting, opts)` — json / text / markdown
  - `formatTranscript(transcript, opts)` — json / text
  - `formatQueryResult(result, opts)` — json / text
  - `formatAuthStatus(status, opts)` — json / text
- [ ] Implement `src/utils/tty.ts`:
  - `isTTY`, `isColorEnabled`, `terminalWidth()`
- [ ] Write `tests/output/formatter.test.ts`:
  - Table output contains expected column headers
  - JSON output is valid JSON and contains expected fields
  - CSV output has correct header row
  - Markdown output is valid markdown table
  - `detectDefaultFormat` returns `json` when `isTTY` is false

**Acceptance criteria:**
- All formatter tests pass
- Table renders correctly in terminal (manual check)

---

### 2.2 Error Handler

**Tasks:**
- [ ] Implement `src/output/errors.ts`:
  - Error class hierarchy: `GranolaError`, `AuthError`, `RateLimitError`, `NotFoundError`
  - `handleError(err)`: formats error to stderr (colored TTY / JSON piped); calls `process.exit(exitCode)`
  - Map HTTP status codes to error classes in MCP client
- [ ] Update `src/index.ts` `.catch()` to use `handleError`

**Acceptance criteria:**
- Auth error exits with code 2
- Not found error exits with code 4
- Rate limit error exits with code 3
- JSON error format when stdout is piped (test by redirecting stderr)

---

### 2.3 Date Parsing Utilities

**Tasks:**
- [ ] Implement `src/utils/dates.ts`:
  - `parseDate(input, referenceDate?)` — chrono-node wrapper
  - `validateIsoDate(input)` — regex + Date parse validation
  - `resolveDate(input)` — throws user-friendly error for invalid input
- [ ] Write tests covering:
  - "last Monday" → correct ISO date
  - "2 weeks ago" → correct ISO date
  - "2026-02-01" → passes through correctly
  - Invalid input → throws with helpful message

**Acceptance criteria:**
- Tests pass; natural language date parsing works in `meetings list`

---

### 2.4–2.6 Meetings Commands (Full)

**Tasks:**
- [ ] `meetings list` — full implementation with all flags and formatting
  - `--since` / `--until` with `resolveDate()`
  - `--attendee` filter passed to MCP
  - `--limit` with default of 20
  - Output via `formatMeetingsList()`
- [ ] `meetings get <id>` — full implementation
  - `--no-private` → `include_private: false`
  - `--no-enhanced` → `include_enhanced: false`
  - Output via `formatMeetingDetail()`
- [ ] `meetings transcript <id>` — full implementation
  - Output via `formatTranscript()`
  - Surface subscription error clearly
- [ ] Write integration tests for each using mock MCP server

**Acceptance criteria:**
- `meetings list --since "last week"` returns correct filtered results
- `meetings get <id>` prints all sections
- `meetings transcript <id>` prints speaker-attributed text
- All commands exit 0 on success, correct non-zero on error

---

### 2.7 Query Command

**Tasks:**
- [ ] Implement `src/commands/query.ts`:
  - Required positional argument: `<question>`
  - 60s timeout (override default 30s)
  - `text` as default TTY format
  - Output via `formatQueryResult()`
- [ ] Write integration tests with mock server

**Acceptance criteria:**
- `granola query "What happened last week?"` returns answer text
- JSON format works: `granola query "..." --format json | jq .answer`
- Timeout after 60s with helpful error message

---

### 2.8 Config Command

**Tasks:**
- [ ] Implement `granola config` command inline in `src/index.ts` or a new `commands/config.ts`
- [ ] Implement `src/utils/config.ts`:
  - `getConfig()` — reads `~/.granola/config.json`; returns defaults if missing
  - `setConfig(partial)` — merges and writes config
- [ ] Display: config file path, credential storage method, MCP server URL, default limit

**Phase 2 Milestone check:**
- [ ] `granola meetings list --since "last week"` → formatted table ✓
- [ ] `granola meetings list | jq .` → valid JSON array ✓
- [ ] `granola meetings get <id>` → formatted meeting detail ✓
- [ ] `granola meetings transcript <id>` → formatted transcript ✓
- [ ] `granola query "..."` → natural language answer ✓

---

## Phase 3 — Polish & Distribution

**Goal:** Production-ready CLI with robust error handling, a complete test suite, and npm publication.

**Milestone:** `npx granola-cli --help` works; package published on npm.

---

### 3.1 Rich `--help` Text

**Tasks:**
- [ ] Add `.description()` and `.addHelpText("after", examples)` to every command
- [ ] Ensure every flag has a clear description with its default value noted
- [ ] Add an "Examples:" section to each command's help
- [ ] Verify `granola --help`, `granola meetings --help`, `granola meetings list --help` all look polished
- [ ] Test that examples in help text actually work

**Goal:** An AI agent reading `granola meetings list --help` should be able to use the command correctly without any other documentation.

**Example help output:**
```
Usage: granola meetings list [options]

List meetings from your Granola account.

Options:
  --since <date>     Return meetings after this date. Accepts ISO 8601 or natural
                     language: "last Monday", "2 weeks ago", "2026-02-01". (default: none)
  --until <date>     Return meetings before this date. Same formats as --since.
  --attendee <name>  Filter by attendee name or email address.
  --limit <n>        Maximum number of meetings to return. (default: 20)
  --format <fmt>     Output format: json, table, csv, markdown. (default: table in TTY, json when piped)
  -h, --help         Display help for command.

Examples:
  $ granola meetings list
  $ granola meetings list --since "last week"
  $ granola meetings list --since 2026-02-01 --attendee alice@example.com
  $ granola meetings list --format csv > meetings.csv
  $ granola meetings list | jq '.[0].id'
```

---

### 3.2 Token Auto-Refresh

**Tasks:**
- [ ] Ensure `getValidToken()` in `token-store.ts` checks expiry with 5-minute window
- [ ] Ensure `McpClient` handles 401 → refresh → retry transparently
- [ ] Verify refresh is transparent: no output, no interruption to command execution
- [ ] Test: command succeeds even when token is 1 minute from expiry (mock token endpoint)
- [ ] Test: `AuthError` is thrown if refresh token is invalid (mock 400 from token endpoint)

**Acceptance criteria:**
- User never sees a "token expired" error mid-session; refresh is automatic

---

### 3.3 Rate Limit Handling

**Tasks:**
- [ ] Verify `Retry-After` header parsing handles both integer seconds and HTTP-date format
- [ ] Implement exponential backoff fallback when no `Retry-After` header present
- [ ] Print a user-visible message when retrying due to rate limit: `"Rate limited. Retrying in 5s..."`
- [ ] After 3 failed retries, exit with code 3 and clear error message
- [ ] Test: mock server returns 429 × 3, verify exit code 3

**Acceptance criteria:**
- Rate limit handling is robust for both header formats
- User sees informative progress messages during backoff

---

### 3.4 `GRANOLA_TOKEN` Environment Variable

**Tasks:**
- [ ] In `getValidToken()`, check `process.env.GRANOLA_TOKEN` first
- [ ] If set, return it directly (no refresh, no keychain lookup)
- [ ] Document in `--help` output: "Set GRANOLA_TOKEN to bypass OAuth"
- [ ] Test: `GRANOLA_TOKEN=test granola meetings list` uses the env var token

**Acceptance criteria:**
- `GRANOLA_TOKEN=eyJ... granola meetings list --format json` works end-to-end with a valid token

---

### 3.5 Test Suite

**Target:** >80% line coverage, >80% function coverage, >70% branch coverage.

**Tasks:**
- [ ] `tests/auth/pkce.test.ts` — PKCE generation (already done in 1.2)
- [ ] `tests/auth/oauth.test.ts` — Discovery, DCR, login flow (mocked fetch)
- [ ] `tests/auth/token-store.test.ts` — Storage, load, refresh (mocked keytar + fs)
- [ ] `tests/mcp/mock-server.ts` — Mock server implementation (reusable across tests)
- [ ] `tests/commands/auth.test.ts` — Auth commands via process spawn or programmatic invocation
- [ ] `tests/commands/meetings.test.ts` — Meetings commands against mock server
- [ ] `tests/commands/query.test.ts` — Query command against mock server
- [ ] `tests/output/formatter.test.ts` — Formatter output for all formats and command types
- [ ] Run `pnpm test --coverage` and confirm thresholds pass

**Test patterns:**
- Use `vi.mock()` for keytar (native module)
- Use `vi.spyOn(process, 'exit')` to test exit codes without actually exiting
- Use `vitest`'s `capture` or pipe to test stdout/stderr
- Spin up mock MCP server in `beforeAll`, shut it down in `afterAll`

**Acceptance criteria:**
- `pnpm test` exits 0
- Coverage report shows ≥80% lines and functions

---

### 3.6 npm Publication

**Tasks:**
- [ ] Set final `package.json` fields: `name: "granola-cli"`, `version: "1.0.0"`, `description`, `keywords`, `repository`, `homepage`, `license: "MIT"`
- [ ] Add `LICENSE` file (MIT)
- [ ] Add `.npmignore` or use `"files": ["dist"]` in `package.json` (already done)
- [ ] Set `"main"` and `"exports"` fields correctly for ESM
- [ ] Run `pnpm pack` and inspect the tarball: verify only `dist/` and `package.json` are included
- [ ] Run `npx . --help` from the packed tarball to verify
- [ ] Publish: `npm publish --access public`
- [ ] Verify: `npx granola-cli@latest --help` works from a fresh directory

**Acceptance criteria:**
- `npx granola-cli --help` prints usage from npm ✓
- `npx granola-cli auth login` works end-to-end ✓

**Phase 3 Milestone check:**
- [ ] All tests pass with ≥80% coverage ✓
- [ ] `npx granola-cli --help` works from npm ✓
- [ ] Package is published at `https://npmjs.com/package/granola-cli` ✓

---

## Phase 4 — Advanced (Ongoing)

These features are post-launch improvements. They don't block the initial release.

---

### `granola watch`

Poll for new meetings and stream updates as NDJSON (newline-delimited JSON):

```bash
granola watch           # Polls every 60s, prints new meetings as NDJSON
granola watch --interval 30s
```

Implementation:
- `setInterval()` calling `list_meetings` with `since` = last seen meeting timestamp
- Emit new meetings as `JSON.stringify(meeting) + "\n"` to stdout
- Ctrl+C exits cleanly (SIGINT handler)

---

### `granola export`

Bulk export meetings to markdown files with YAML frontmatter:

```bash
granola export ./notes/          # Exports all meetings to ./notes/YYYY-MM-DD-title.md
granola export --since "last month" ./notes/
```

File format:
```markdown
---
id: mtg_01abc123
title: Q1 Planning Session
date: 2026-02-28
attendees:
  - Andy Hahn
  - Alice Smith
---

## Notes

...
```

---

### Shell Completions

Generate shell completion scripts for bash, zsh, and fish:

```bash
granola completions bash   # Prints bash completion script
granola completions zsh    # Prints zsh completion script
granola completions fish   # Prints fish completion script
```

Commander supports completion generation via `commander-completion` or manual implementation.

---

### `granola meetings search <term>`

Full-text search across meeting titles and attendees (client-side filtering, since the MCP API may not support it directly):

```bash
granola meetings search "API review"
granola meetings search --attendee alice "architecture"
```

---

### Extended `granola config`

Add `get` and `set` subcommands for individual config values:

```bash
granola config get defaultLimit
granola config set defaultLimit 50
granola config set mcpUrl https://staging.mcp.granola.ai/mcp
```

---

### Standalone Binaries

Produce self-contained executables that don't require Node.js installed:

```bash
# Using Bun's compile feature
bun build --compile src/index.ts --target bun-darwin-arm64 --outfile granola-macos-arm64
bun build --compile src/index.ts --target bun-darwin-x64 --outfile granola-macos-x64
bun build --compile src/index.ts --target bun-linux-x64 --outfile granola-linux-x64
bun build --compile src/index.ts --target bun-windows-x64 --outfile granola-windows-x64.exe
```

Attach to GitHub Releases for direct download without Node.js or npm.

---

## Dependency Graph Between Tasks

```
1.1 Scaffolding
  └─► 1.2 PKCE
  └─► 1.4 Callback Server
        └─► 1.3 Discovery + DCR
              └─► 1.5 Login Flow
                    └─► 1.6 Token Store
                          └─► 1.7 MCP Client
                                └─► 1.8 Auth Commands
                                      └─► 1.9 Minimal Meetings
                                            └─► PHASE 1 ✓
                                                  └─► 2.1 Formatter
                                                  └─► 2.2 Error Handler
                                                  └─► 2.3 Date Utils
                                                        └─► 2.4 Meetings Full
                                                        └─► 2.7 Query
                                                              └─► PHASE 2 ✓
                                                                    └─► 3.1-3.5 Polish + Tests
                                                                          └─► 3.6 Publish
                                                                                └─► PHASE 3 ✓
```

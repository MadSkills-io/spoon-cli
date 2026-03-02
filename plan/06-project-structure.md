# Project Structure

## Overview

The project follows a clean, modular layout where each file has a single, well-defined responsibility. The structure is designed to be immediately navigable — a developer or AI agent reading the file tree should be able to infer what each file does without opening it.

---

## Full File Tree

```
granola-cli/
│
├── src/
│   ├── index.ts                        # Entry point; commander root; registers all commands
│   │
│   ├── commands/
│   │   ├── auth.ts                     # auth login | logout | status
│   │   ├── meetings.ts                 # meetings list | get | transcript
│   │   └── query.ts                    # query "<question>"
│   │
│   ├── mcp/
│   │   ├── client.ts                   # McpClient: auth injection, auto-init, retry, timeouts
│   │   └── types.ts                    # Meeting, Attendee, Transcript, QueryResult interfaces
│   │
│   ├── auth/
│   │   ├── oauth.ts                    # OAuth 2.1: discovery, DCR, token exchange, refresh
│   │   ├── pkce.ts                     # PKCE: generateVerifier(), generateChallenge()
│   │   ├── token-store.ts              # keytar + ~/.granola/credentials.json fallback
│   │   └── callback-server.ts          # Local HTTP server for OAuth redirect callback
│   │
│   ├── output/
│   │   ├── formatter.ts                # json | table | csv | markdown | text output
│   │   └── errors.ts                   # Structured errors to stderr + exit codes
│   │
│   └── utils/
│       ├── dates.ts                    # chrono-node wrapper: natural language → ISO 8601
│       ├── config.ts                   # ~/.granola/config.json read/write
│       └── tty.ts                      # process.stdout.isTTY + color detection helpers
│
├── tests/
│   ├── mcp/
│   │   └── mock-server.ts              # Mock MCP server for integration tests
│   │
│   ├── auth/
│   │   ├── pkce.test.ts               # PKCE verifier + challenge generation
│   │   ├── oauth.test.ts              # OAuth flow (mocked HTTP)
│   │   └── token-store.test.ts        # Credential storage + retrieval
│   │
│   ├── commands/
│   │   ├── auth.test.ts               # auth login/logout/status integration tests
│   │   ├── meetings.test.ts           # meetings list/get/transcript integration tests
│   │   └── query.test.ts              # query command integration tests
│   │
│   └── output/
│       └── formatter.test.ts          # Output format correctness tests
│
├── AGENTS.md                           # AI agent project conventions
├── CLAUDE.md -> AGENTS.md              # Symlink (Claude Code reads CLAUDE.md)
├── package.json                        # bin: { "granola": "dist/index.js" }
├── tsconfig.json                       # TypeScript configuration
├── tsup.config.ts                      # Build configuration (esbuild-based)
├── vitest.config.ts                    # Test runner configuration
└── pnpm-lock.yaml                      # Lockfile
```

---

## Source Files: Detailed Descriptions

### `src/index.ts` — Entry Point

The root commander program. Responsibilities:
- Sets up `commander` with version, description, and global flags
- Imports and registers all subcommand trees (`auth`, `meetings`, `query`, `config`)
- Sets up global error handling and process exit
- Contains the `#!/usr/bin/env node` shebang

Approximate size: ~80 lines

```typescript
#!/usr/bin/env node
import { program } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerMeetingsCommands } from "./commands/meetings.js";
import { registerQueryCommand } from "./commands/query.js";
import { version } from "../package.json" assert { type: "json" };

program
  .name("granola")
  .description("CLI for Granola AI meeting notes")
  .version(version)
  .option("--debug", "Enable debug output")
  .option("--no-color", "Disable color output");

registerAuthCommands(program);
registerMeetingsCommands(program);
registerQueryCommand(program);

program.parseAsync(process.argv).catch((err) => {
  handleFatalError(err);
});
```

---

### `src/commands/auth.ts` — Auth Commands

Registers the `granola auth` command tree. Contains handlers for:
- `auth login` — runs the full OAuth flow, prints success/failure
- `auth logout` — clears credentials, prints confirmation
- `auth status` — loads and displays credential metadata

Dependencies: `oauth.ts`, `token-store.ts`, `formatter.ts`, `errors.ts`

Approximate size: ~120 lines

---

### `src/commands/meetings.ts` — Meetings Commands

Registers the `granola meetings` command tree. Contains handlers for:
- `meetings list` — calls `list_meetings`, applies filters, formats output
- `meetings get <id>` — calls `get_meetings`, formats output
- `meetings transcript <id>` — calls `get_meeting_transcript`, formats output

Each handler:
1. Parses and validates arguments
2. Resolves natural language dates via `dates.ts`
3. Calls `McpClient.callTool()`
4. Passes result to `formatter.ts`

Dependencies: `client.ts`, `dates.ts`, `formatter.ts`, `errors.ts`

Approximate size: ~180 lines

---

### `src/commands/query.ts` — Query Command

Registers `granola query "<question>"`. Applies the 60-second timeout. Uses `text` format by default (vs `table` for meetings list).

Dependencies: `client.ts`, `formatter.ts`, `errors.ts`

Approximate size: ~60 lines

---

### `src/mcp/client.ts` — MCP Client Wrapper

The `McpClient` class. See `05-mcp-client.md` for full details.

Key responsibilities:
- Lazy initialization (first call triggers `connect()`)
- Auth header injection into `StreamableHTTPClientTransport`
- Error recovery: 401 refresh, 404 session recovery, 429/5xx backoff
- Per-operation timeouts
- Debug logging

Dependencies: `@modelcontextprotocol/sdk`, `token-store.ts`

Approximate size: ~200 lines

---

### `src/mcp/types.ts` — MCP Type Definitions

TypeScript interfaces for all MCP tool responses:
- `Meeting`, `Attendee`, `MeetingDetail`
- `Transcript`, `TranscriptSegment`
- `QueryResult`

Approximate size: ~60 lines

---

### `src/auth/oauth.ts` — OAuth 2.1 Flow

Core OAuth implementation:
- `discoverEndpoints()` — RFC 8414 discovery with fallback
- `registerClient()` — DCR (RFC 7591); caches result
- `login()` — Orchestrates full login: PKCE, callback server, browser open, token exchange
- `refreshToken()` — Refresh grant flow
- `revokeToken()` — Revocation endpoint call

Dependencies: `pkce.ts`, `callback-server.ts`, `token-store.ts`, `open` (npm)

Approximate size: ~220 lines

---

### `src/auth/pkce.ts` — PKCE Utilities

Two exported functions:
- `generateVerifier()` — 96 random bytes, base64url encoded
- `generateChallenge(verifier)` — SHA-256 of verifier, base64url encoded

No external dependencies (uses Node.js `crypto` built-in).

Approximate size: ~25 lines

---

### `src/auth/token-store.ts` — Credential Storage

Manages read/write/delete of stored credentials with two backends:
- **Primary:** `keytar` (OS keychain: macOS Keychain, Linux Secret Service, Windows Credential Store)
- **Fallback:** `~/.granola/credentials.json` with `chmod 0600`

Exports:
- `storeCredentials(creds)` — saves token data
- `loadCredentials()` — returns `StoredCredentials | null`
- `clearCredentials()` — deletes stored credentials
- `getValidToken(opts?)` — loads credentials, checks expiry, refreshes if needed

Approximate size: ~130 lines

---

### `src/auth/callback-server.ts` — OAuth Callback Server

Starts a temporary local HTTP server on a random port to receive the OAuth redirect.

- Uses `net.Server` to get a random port (port `0`)
- Validates `state` parameter on callback
- Returns a friendly HTML page to the browser on success
- Times out after 120 seconds
- Cleans up server after receiving callback or timeout

Approximate size: ~90 lines

---

### `src/output/formatter.ts` — Output Formatter

The single output rendering module. All command output goes through here.

```typescript
export interface FormatOptions {
  format: "json" | "table" | "csv" | "markdown" | "text";
  stream?: NodeJS.WritableStream; // default: process.stdout
}

export function formatMeetingsList(meetings: Meeting[], opts: FormatOptions): void;
export function formatMeetingDetail(meeting: MeetingDetail, opts: FormatOptions): void;
export function formatTranscript(transcript: Transcript, opts: FormatOptions): void;
export function formatQueryResult(result: QueryResult, opts: FormatOptions): void;
export function formatAuthStatus(status: AuthStatus, opts: FormatOptions): void;
export function detectDefaultFormat(command: string): FormatOptions["format"];
```

`detectDefaultFormat()` implements the TTY detection logic:
- `process.stdout.isTTY` → `table` (meetings list) or `text` (query, meeting detail)
- Not TTY → `json`

Dependencies: `cli-table3`, `chalk`

Approximate size: ~200 lines

---

### `src/output/errors.ts` — Error Handling

Defines the error hierarchy and `handleError()` function.

```typescript
export class GranolaError extends Error {
  constructor(message: string, public exitCode: number = 1) { super(message); }
}
export class AuthError extends GranolaError {
  constructor(message: string) { super(message, 2); }
}
export class RateLimitError extends GranolaError {
  constructor(message: string) { super(message, 3); }
}
export class NotFoundError extends GranolaError {
  constructor(message: string) { super(message, 4); }
}

export function handleError(err: unknown): never;
```

`handleError()`:
- Writes to `process.stderr`
- If TTY: colored human-readable message
- If piped: JSON `{ "error": "...", "code": 2 }`
- Calls `process.exit(exitCode)`

Approximate size: ~80 lines

---

### `src/utils/dates.ts` — Date Parsing

Wraps `chrono-node` for natural language date parsing:

```typescript
export function parseDate(input: string, referenceDate?: Date): string | null;
// Returns ISO 8601 string or null if unparseable

export function validateIsoDate(input: string): boolean;
// Validates ISO 8601 date strings (YYYY-MM-DD or full datetime)

export function resolveDate(input: string): string;
// Tries parseDate; throws user-friendly error if unparseable
```

Examples of inputs that work:
- `"last Monday"` → `"2026-02-23T00:00:00.000Z"`
- `"2 weeks ago"` → `"2026-02-16T00:00:00.000Z"`
- `"yesterday"` → `"2026-03-01T00:00:00.000Z"`
- `"2026-02-01"` → `"2026-02-01T00:00:00.000Z"` (passes through)
- `"2026-02-01T09:00:00Z"` → `"2026-02-01T09:00:00.000Z"` (passes through)

Approximate size: ~40 lines

---

### `src/utils/config.ts` — Configuration

Reads and writes `~/.granola/config.json`. Provides typed access to CLI settings:

```typescript
interface GranolaConfig {
  defaultLimit?: number;      // default: 20
  defaultFormat?: string;     // default: auto-detect
  mcpUrl?: string;            // default: https://mcp.granola.ai/mcp
}

export async function getConfig(): Promise<GranolaConfig>;
export async function setConfig(partial: Partial<GranolaConfig>): Promise<void>;
```

Approximate size: ~50 lines

---

### `src/utils/tty.ts` — TTY Utilities

Simple helpers for terminal detection and color configuration:

```typescript
export const isTTY = Boolean(process.stdout.isTTY);
export const isColorEnabled = isTTY && !process.env.NO_COLOR && !process.env.TERM?.startsWith("dumb");
export function terminalWidth(): number; // process.stdout.columns ?? 80
```

Approximate size: ~20 lines

---

## Configuration Files

### `package.json` — Package Configuration

```json
{
  "name": "granola-cli",
  "version": "1.0.0",
  "description": "CLI for Granola AI meeting notes",
  "type": "module",
  "bin": {
    "granola": "./dist/index.js"
  },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "prepublishOnly": "pnpm build && pnpm test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "chalk": "^5.3.0",
    "chrono-node": "^2.7.0",
    "cli-table3": "^0.6.4",
    "commander": "^12.0.0",
    "keytar": "^7.9.0",
    "open": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.5.0"
  }
}
```

### `tsconfig.json` — TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### `tsup.config.ts` — Build Configuration

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",  // Injects shebang into dist/index.js
  },
  external: ["keytar"],  // Native module; not bundled
});
```

**Why `keytar` is external:** `keytar` is a native Node.js addon (`.node` binary) that can't be bundled. It's loaded at runtime via `require()`/`import()`. If unavailable, the auth layer falls back to file storage.

### `vitest.config.ts` — Test Configuration

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      threshold: { lines: 80, functions: 80, branches: 70 },
      exclude: ["tests/**", "dist/**"],
    },
  },
});
```

---

## Dependency Rationale

| Package | Version | Why This Package |
|---------|---------|-----------------|
| `@modelcontextprotocol/sdk` | `^1.0.0` | Official MCP SDK; eliminates need to implement Streamable HTTP transport, JSON-RPC framing, SSE parsing, session management |
| `commander` | `^12.0.0` | Industry standard for Node.js CLI frameworks; auto-generates `--help`; strong TypeScript types; no runtime overhead |
| `chalk` | `^5.3.0` | Terminal color library with automatic NO_COLOR/TERM detection; ESM-native in v5 |
| `cli-table3` | `^0.6.4` | Flexible ASCII table rendering; supports column alignment, wrapping, custom borders |
| `chrono-node` | `^2.7.0` | The best JS natural language date parser; handles "last Monday", "2 weeks ago", relative dates |
| `keytar` | `^7.9.0` | Cross-platform OS keychain access; macOS Keychain, Windows Credential Store, Linux Secret Service |
| `open` | `^10.0.0` | Cross-platform browser opener (`xdg-open` on Linux, `open` on macOS, `start` on Windows) |
| `tsup` | `^8.0.0` | Fast esbuild-based bundler; bundles `src/` → `dist/`; handles ESM properly |
| `vitest` | `^1.5.0` | Fast, TypeScript-native test runner; compatible with ESM; no transform config needed |

**Packages deliberately avoided:**

| Package | Why Avoided |
|---------|-------------|
| `axios` / `got` / `node-fetch` | Node.js 20+ has native `fetch`; no HTTP library needed |
| `oclif` | Too heavy for a focused CLI; generates excessive boilerplate |
| `ink` | React-based TUI; overkill for this use case |
| `inquirer` | Interactive prompts not needed; auth is browser-based |
| `dotenv` | Only `GRANOLA_TOKEN` env var is needed; process.env access is sufficient |
| `winston` / `pino` | Debug logging via `--debug` flag and stderr is sufficient |

---

## `~/.granola/` Directory Layout

Runtime data stored in the user's home directory:

```
~/.granola/                (mode 0700)
├── config.json            (mode 0600) — user preferences
├── credentials.json       (mode 0600) — token storage fallback (if keytar unavailable)
└── client.json            (mode 0600) — cached OAuth DCR client registration
```

**`config.json` schema:**
```json
{
  "defaultLimit": 20,
  "mcpUrl": "https://mcp.granola.ai/mcp"
}
```

**`client.json` schema:**
```json
{
  "client_id": "abc-123-xyz",
  "registration_endpoint": "https://mcp.granola.ai/register",
  "registered_at": "2026-03-02T10:00:00Z"
}
```

**`credentials.json` schema (file fallback):**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "rt_...",
  "expires_at": "2026-03-09T10:00:00Z",
  "user_email": "andy@example.com"
}
```

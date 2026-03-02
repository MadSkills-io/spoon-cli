# Architecture: Granola CLI

## Overview

The Granola CLI is structured as four discrete layers, each with a single well-defined responsibility. This separation makes the codebase testable, maintainable, and easy to extend — adding a new command never touches the auth layer; swapping the MCP transport never touches command parsing.

---

## High-Level Diagram

```
┌──────────────────────────────────────────────────────┐
│  CLI Layer (commander.js)                             │
│  • Parses arguments and subcommands                   │
│  • Dispatches to command handlers                     │
│  • Formats and prints output (table / JSON / text)   │
│  • Handles --help, --version, --format                │
├──────────────────────────────────────────────────────┤
│  Service Layer                                        │
│  • Business logic per command                         │
│  • Natural language date parsing → ISO 8601           │
│  • Maps CLI arguments to MCP tool parameters          │
│  • Owns output format decisions                       │
├──────────────────────────────────────────────────────┤
│  MCP Client Layer (@modelcontextprotocol/sdk)         │
│  • Thin wrapper around the official SDK               │
│  • Injects Authorization header                       │
│  • Auto-initializes session on first call             │
│  • Handles 401 → token refresh → retry                │
│  • Applies per-operation timeouts                     │
├──────────────────────────────────────────────────────┤
│  Auth Layer                                           │
│  • OAuth 2.1 + PKCE + DCR flow                        │
│  • Token storage: OS keychain (keytar) or file        │
│  • Token refresh logic                                │
│  • GRANOLA_TOKEN env var override                     │
└──────────────────────────────────────────────────────┘
                  │ HTTPS POST (JSON-RPC 2.0)
                  ▼
        https://mcp.granola.ai/mcp
```

---

## Layer Responsibilities

### 1. CLI Layer (`src/index.ts`, `src/commands/`)

The CLI layer is the user-facing surface. It is built on `commander.js` and is responsible for:

- Defining the command tree (`granola auth login`, `granola meetings list`, etc.)
- Parsing flags and positional arguments
- Rendering output to `process.stdout` in the format appropriate for the context (TTY vs piped)
- Routing errors to `process.stderr` with appropriate exit codes
- Generating `--help` text that is useful to both humans and AI agents

The CLI layer **does not contain business logic**. It calls into service-layer functions and renders the results. This keeps commands thin and testable.

```
src/
├── index.ts          ← commander root; registers all subcommand trees
└── commands/
    ├── auth.ts       ← auth login | logout | status
    ├── meetings.ts   ← meetings list | get | transcript
    └── query.ts      ← query "<question>"
```

### 2. Service Layer (inline within commands)

The service layer translates CLI arguments into MCP tool parameters and applies business rules:

- **Date parsing:** `--since "last Monday"` → `chrono-node` → `2026-02-23T00:00:00Z`
- **Pagination defaults:** `--limit` defaults to 20 if not specified
- **Flag semantics:** `--no-private` maps to `include_private: false`
- **Timeout selection:** `query` gets 60s; `list` gets 30s
- **Output routing:** decides whether to emit a table, JSON, CSV, markdown, or plain text

In the current design, service logic lives inside command handlers rather than a separate directory, keeping files co-located. If the project grows, this logic can be extracted to `src/services/`.

### 3. MCP Client Layer (`src/mcp/client.ts`)

The MCP client layer wraps `@modelcontextprotocol/sdk`'s `Client` class with production-grade behavior:

- **Auth injection:** Retrieves the current access token from the auth layer and injects it as an `Authorization: Bearer <token>` header into the `StreamableHTTPClientTransport`
- **Auto-initialization:** The first `callTool()` lazily calls `client.connect()` which sends the `InitializeRequest` and captures the `Mcp-Session-Id`
- **Session recovery:** On 404 with a session ID, the client re-initializes before retrying
- **401 handling:** On 401, attempts token refresh; if successful, re-injects the new token and retries once; if refresh fails, exits with code 2
- **Retry with backoff:** For 429 and 5xx, applies the error recovery matrix described below

The SDK handles all the low-level concerns:
- JSON-RPC 2.0 message framing and ID tracking
- SSE stream parsing for `text/event-stream` responses
- `Mcp-Session-Id` header echoing on subsequent requests

```typescript
// Conceptual shape of McpClient
class McpClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private initialized = false;

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureInitialized();
    return this.client.callTool({ name, arguments: args });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    const token = await getToken(); // from auth layer
    this.transport = new StreamableHTTPClientTransport(MCP_URL, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    });
    await this.client.connect(this.transport);
    this.initialized = true;
  }
}
```

### 4. Auth Layer (`src/auth/`)

The auth layer manages the full credential lifecycle:

- **Discovery:** `GET /.well-known/oauth-authorization-server` to find the authorization server metadata; falls back to conventional paths on 404
- **DCR:** `POST /register` to dynamically register the CLI as an OAuth client; caches `client_id` in `~/.granola/client.json`
- **PKCE:** Generates `code_verifier` (random 96-byte URL-safe base64) and `code_challenge` (SHA-256 hash, base64url-encoded)
- **Browser flow:** Starts a local HTTP callback server, opens the browser to the authorization URL, waits for the redirect
- **Token exchange:** `POST /token` with the auth code + PKCE verifier
- **Storage:** Stores `access_token`, `refresh_token`, and `expires_at` in the OS keychain via `keytar`; falls back to `~/.granola/credentials.json` with `chmod 0600`
- **Refresh:** Transparently refreshes the token if it expires within 5 minutes
- **Env override:** If `GRANOLA_TOKEN` is set, bypasses all OAuth logic

---

## Data Flow: `granola meetings list --since "last week"`

```
User
 │
 ▼
[CLI Layer]
  • commander parses: subcommand=meetings list, --since="last week"
  • calls meetingsListHandler({ since: "last week" })
 │
 ▼
[Service Layer]
  • chrono-node.parseDate("last week") → 2026-02-23T00:00:00Z
  • builds MCP params: { since: "2026-02-23T00:00:00Z", limit: 20 }
  • detects TTY → will format as table
 │
 ▼
[MCP Client Layer]
  • ensureInitialized() → reads token from auth layer
  • creates StreamableHTTPClientTransport with Authorization header
  • client.connect() → InitializeRequest → receives Mcp-Session-Id
  • client.callTool("list_meetings", params)
  • sends: POST https://mcp.granola.ai/mcp  (JSON-RPC tools/call)
 │
 ▼
[Granola MCP Server]
  • validates token, looks up meetings, returns JSON-RPC result
 │
 ▼
[MCP Client Layer]
  • receives result; extracts content[0].text
  • JSON.parse → array of meeting objects
 │
 ▼
[Service Layer]
  • passes meetings array to formatter
 │
 ▼
[CLI Layer / Output Layer]
  • process.stdout.isTTY → renders cli-table3 table
  • prints: ID | Title | Date | Attendees
```

---

## Session Lifecycle

```
┌─────────────────────────────────────────────────────┐
│                  Session Lifecycle                   │
│                                                      │
│  First call:                                         │
│  ┌──────────┐    InitializeRequest    ┌───────────┐ │
│  │  Client  │ ──────────────────────► │  Server   │ │
│  │          │ ◄────────────────────── │           │ │
│  │          │  200 OK                 │           │ │
│  │          │  Mcp-Session-Id: abc123 │           │ │
│  └──────────┘                         └───────────┘ │
│                                                      │
│  Subsequent calls:                                   │
│  ┌──────────┐   tools/call            ┌───────────┐ │
│  │  Client  │ ──────────────────────► │  Server   │ │
│  │ (echo    │   Mcp-Session-Id: abc123│           │ │
│  │  session)│ ◄────────────────────── │           │ │
│  └──────────┘   result                └───────────┘ │
│                                                      │
│  Session lost (404):                                 │
│  ┌──────────┐   tools/call            ┌───────────┐ │
│  │  Client  │ ──────────────────────► │  Server   │ │
│  │          │ ◄────────────────────── │           │ │
│  │          │   404 (session not found│           │ │
│  │          │   re-initialize...      │           │ │
│  │          │ ──────────────────────► │           │ │
│  │          │   InitializeRequest     │           │ │
│  │          │ ◄────────────────────── │           │ │
│  │          │   new Mcp-Session-Id    │           │ │
│  │          │ ──────────────────────► │           │ │
│  └──────────┘   retry tools/call      └───────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Error Flow

```
MCP call fails
      │
      ├─ 401 Unauthorized
      │      │
      │      ├─ attempt token refresh
      │      │      ├─ success → re-inject token → retry once
      │      │      └─ failure → stderr "Authentication failed" → exit(2)
      │
      ├─ 404 (with Mcp-Session-Id header)
      │      │
      │      └─ re-initialize session → retry
      │
      ├─ 429 Too Many Requests
      │      │
      │      ├─ parse Retry-After header (seconds or HTTP-date)
      │      ├─ sleep(retryAfter)
      │      └─ retry (max 3 times) → exit(3) if exhausted
      │
      ├─ 5xx Server Error
      │      │
      │      ├─ exponential backoff: 1s → 2s → 4s
      │      └─ retry max 3 times → exit(1) if exhausted
      │
      └─ Network error / timeout
             │
             └─ stderr human-readable message → exit(1)
```

---

## Output Strategy

Output format is determined by a two-step precedence rule:

1. **Explicit `--format` flag** always wins
2. **TTY detection** (`process.stdout.isTTY`) as default:
   - `true` (interactive terminal) → table or text (human-friendly)
   - `false` (piped to file, another process, CI) → JSON

This mirrors the behavior of `gh`, `docker`, and `stripe` CLIs, and ensures that:

- Humans get readable output by default
- Scripts and AI agents automatically get machine-parseable JSON
- `--format` provides explicit override for any situation

```
process.stdout.isTTY?
      │
      ├─ true  → default format: table (meetings list) / text (query)
      └─ false → default format: JSON

--format flag? → overrides above regardless
```

**Supported formats:**

| Format     | Description                                    | Best for              |
|------------|------------------------------------------------|-----------------------|
| `json`     | Full JSON array/object, pretty-printed         | Scripts, AI agents    |
| `table`    | ASCII table via cli-table3                     | Interactive TTY       |
| `csv`      | Comma-separated values with header row         | Spreadsheet import    |
| `markdown` | Markdown table or structured document          | Reports, docs         |
| `text`     | Plain prose (used for `query` output)          | Human reading         |

---

## Key Design Constraints

| Constraint | Rationale |
|------------|-----------|
| No global state | Each command invocation is independent; safe for concurrent shell use |
| Lazy initialization | MCP session created only when first tool call is made, not at startup |
| Credentials never in process args | No `--token` flag; would expose in `ps aux`. Use env var or file. |
| Stderr for errors always | stdout must be parseable when piped; errors must go to stderr |
| Graceful degradation | If keytar (OS keychain) is unavailable, fall back to file storage silently |

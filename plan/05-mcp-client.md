# MCP Client: Protocol Details & Implementation

## Overview

The MCP client layer is the bridge between the CLI's service logic and the Granola MCP server. It wraps the official `@modelcontextprotocol/sdk` with production-grade behavior: auth injection, session management, error recovery, and per-operation timeouts.

The guiding principle is **minimal reimplementation**: let the SDK handle the protocol; add only the operational concerns the SDK doesn't provide.

---

## Model Context Protocol: What the SDK Handles

The `@modelcontextprotocol/sdk` implements the full Streamable HTTP transport spec, which includes:

### JSON-RPC 2.0 Framing

Every MCP message is a JSON-RPC 2.0 object. The SDK generates these transparently:

```json
// Request (sent by client)
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "tools/call",
  "params": {
    "name": "list_meetings",
    "arguments": { "since": "2026-02-01T00:00:00Z", "limit": 10 }
  }
}

// Response (received from server)
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": {
    "content": [
      { "type": "text", "text": "[{\"id\": \"mtg_01...\", ...}]" }
    ],
    "isError": false
  }
}
```

The SDK:
- Auto-generates and tracks `id` values
- Matches responses to pending requests
- Parses `error` vs `result`
- Throws typed errors for JSON-RPC error responses

### Server-Sent Events (SSE) Parsing

For long-running operations (like `query_granola_meetings`), the server may respond with `Content-Type: text/event-stream`. The SDK's `StreamableHTTPClientTransport`:

1. Detects `text/event-stream` content type
2. Parses the SSE stream (`data: {...}\n\n` frames)
3. Reassembles the final result
4. Returns it to `client.callTool()` as if it were a normal response

The CLI layer does not need to know whether a response was streamed or not.

### Session Management

After the initial `InitializeRequest`, the server returns an `Mcp-Session-Id` header. The SDK:
- Stores this session ID
- Automatically includes it in all subsequent requests as `Mcp-Session-Id: {id}`
- This enables the server to maintain per-session state

### Protocol Initialization

When `client.connect(transport)` is called:

```json
// InitializeRequest (sent automatically by SDK)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": { "roots": {}, "sampling": {} },
    "clientInfo": { "name": "granola-cli", "version": "1.0.0" }
  }
}

// InitializeResult (received from server)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "granola-mcp", "version": "..." }
  }
}
```

---

## MCP Client Implementation

### Core Structure

```typescript
// src/mcp/client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getValidToken } from "../auth/token-store.js";

const MCP_URL = new URL("https://mcp.granola.ai/mcp");

export class McpClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.client = new Client(
      { name: "granola-cli", version: "1.0.0" },
      { capabilities: {} }
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<unknown> {
    await this.ensureInitialized();
    return this.callWithRetry(name, args, options);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    const token = await getValidToken();
    this.transport = new StreamableHTTPClientTransport(MCP_URL, {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });
    await this.client.connect(this.transport);
    this.initialized = true;
    this.initPromise = null;
  }
}
```

### Auth Injection and Refresh

The `Authorization: Bearer <token>` header is injected at transport creation time. When the token needs to be refreshed (after a 401), the transport is recreated:

```typescript
private async refreshAndReinject(): Promise<void> {
  // getValidToken() will detect expiry and refresh
  const newToken = await getValidToken({ forceRefresh: true });
  this.transport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: {
      headers: { Authorization: `Bearer ${newToken}` },
    },
  });
  // Re-connect with new transport (re-sends InitializeRequest)
  await this.client.connect(this.transport);
}
```

### Retry Logic

```typescript
private async callWithRetry(
  name: string,
  args: Record<string, unknown>,
  options?: { timeoutMs?: number },
  attempt = 0
): Promise<unknown> {
  try {
    const result = await withTimeout(
      this.client.callTool({ name, arguments: args }),
      options?.timeoutMs ?? 30_000
    );
    return extractContent(result);
  } catch (err) {
    return this.handleError(err, name, args, options, attempt);
  }
}

private async handleError(
  err: unknown,
  name: string,
  args: Record<string, unknown>,
  options: unknown,
  attempt: number
): Promise<unknown> {
  const status = getHttpStatus(err);

  if (status === 401 && attempt === 0) {
    await this.refreshAndReinject();
    return this.callWithRetry(name, args, options, attempt + 1);
  }

  if (status === 404 && this.initialized) {
    // Session may have been evicted — re-initialize
    this.initialized = false;
    await this.ensureInitialized();
    return this.callWithRetry(name, args, options, attempt + 1);
  }

  if (status === 429 && attempt < 3) {
    const retryAfter = parseRetryAfter(err) ?? Math.pow(2, attempt) * 1000;
    await sleep(retryAfter);
    return this.callWithRetry(name, args, options, attempt + 1);
  }

  if (status >= 500 && attempt < 3) {
    await sleep(Math.pow(2, attempt) * 1000);
    return this.callWithRetry(name, args, options, attempt + 1);
  }

  throw err;
}
```

---

## Error Recovery Matrix

| HTTP Status | Condition | Action | Max Retries |
|-------------|-----------|--------|-------------|
| `401` | First attempt | Refresh token → reinject → retry | 1 |
| `401` | Already retried | Clear credentials → exit(2) | — |
| `404` | Session ID present | Re-initialize session → retry | 1 |
| `404` | No session | Surface as "not found" error | — |
| `429` | Any | Parse `Retry-After` header; default to exponential backoff | 3 |
| `500–599` | Any | Exponential backoff (1s, 2s, 4s) | 3 |
| Network timeout | Any | Surface as timeout error | 0 |
| JSON-RPC error | `isError: true` | Surface tool error message | 0 |

### Retry-After Parsing

The `Retry-After` header can be either a number of seconds or an HTTP-date:

```typescript
function parseRetryAfter(err: unknown): number | null {
  const header = getResponseHeader(err, "retry-after");
  if (!header) return null;

  const seconds = parseInt(header, 10);
  if (!isNaN(seconds)) return seconds * 1000;

  // HTTP-date format: Retry-After: Wed, 04 Mar 2026 10:00:00 GMT
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}
```

---

## Timeouts

Each MCP operation has a different timeout based on expected server-side processing time:

| Operation | Tool | Timeout | Rationale |
|-----------|------|---------|-----------|
| Initialize | `initialize` | 10s | Simple handshake |
| List meetings | `list_meetings` | 30s | Database query |
| Get meeting | `get_meetings` | 30s | Database query + assembly |
| Get transcript | `get_meeting_transcript` | 30s | May involve storage fetch |
| NL query | `query_granola_meetings` | 60s | RAG + LLM generation |

```typescript
const TIMEOUTS: Record<string, number> = {
  initialize: 10_000,
  list_meetings: 30_000,
  get_meetings: 30_000,
  get_meeting_transcript: 30_000,
  query_granola_meetings: 60_000,
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`Operation timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
```

---

## MCP Tool Result Extraction

The SDK returns a `CallToolResult` with a `content` array. For the Granola MCP server, results are always a single `text` block containing JSON:

```typescript
function extractContent(result: CallToolResult): unknown {
  if (result.isError) {
    // Tool-level error (not HTTP error)
    const text = result.content.find(c => c.type === "text")?.text ?? "Unknown tool error";
    throw new McpToolError(text);
  }

  const textBlock = result.content.find(c => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new McpError("Expected text content in tool result");
  }

  try {
    return JSON.parse(textBlock.text);
  } catch {
    // Not JSON — return as plain string (e.g., query answers)
    return textBlock.text;
  }
}
```

---

## Tool Parameter Reference

### `list_meetings`

```typescript
interface ListMeetingsParams {
  since?: string;    // ISO 8601 datetime
  until?: string;    // ISO 8601 datetime
  attendee?: string; // name or email
  limit?: number;    // default: 20
}
```

### `get_meetings`

```typescript
interface GetMeetingsParams {
  id: string;
  include_private?: boolean;  // default: true
  include_enhanced?: boolean; // default: true
}
```

### `get_meeting_transcript`

```typescript
interface GetMeetingTranscriptParams {
  id: string;
}
```

### `query_granola_meetings`

```typescript
interface QueryGranolaMeetingsParams {
  question: string;
}
```

---

## Debug Logging

When `--debug` is enabled, the MCP client logs all requests and responses:

```typescript
if (process.env.GRANOLA_DEBUG || cli.opts().debug) {
  // Log sanitized request
  console.error(`[MCP] → tools/call ${name}`, JSON.stringify(args, null, 2));

  // Log sanitized response (truncate large values)
  console.error(`[MCP] ← result`, JSON.stringify(truncateDeep(result, 200), null, 2));
}
```

**Token sanitization:** The `Authorization` header is never logged. If logging HTTP headers in debug mode, replace the token value with `Bearer <redacted>`.

---

## Mock Server for Testing

The test suite uses a mock MCP server that implements the same JSON-RPC protocol:

```typescript
// tests/mcp/mock-server.ts
import { createServer } from "http";

export function createMockMcpServer(handlers: ToolHandlers) {
  return createServer(async (req, res) => {
    if (req.method !== "POST") return res.writeHead(405).end();

    const body = await readBody(req);
    const message = JSON.parse(body);

    if (message.method === "initialize") {
      res.setHeader("Mcp-Session-Id", "test-session-123");
      return res.end(JSON.stringify({
        jsonrpc: "2.0", id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-granola", version: "0.0.1" }
        }
      }));
    }

    if (message.method === "tools/call") {
      const { name, arguments: args } = message.params;
      const handler = handlers[name];
      if (!handler) {
        return res.end(JSON.stringify({
          jsonrpc: "2.0", id: message.id,
          error: { code: -32601, message: "Tool not found" }
        }));
      }
      const result = await handler(args);
      return res.end(JSON.stringify({
        jsonrpc: "2.0", id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false }
      }));
    }
  });
}
```

Usage in tests:

```typescript
// tests/commands/meetings.test.ts
import { createMockMcpServer } from "../mcp/mock-server.js";

const MOCK_MEETINGS = [
  { id: "mtg_01", title: "Test Meeting", start_time: "2026-02-28T10:00:00Z", ... }
];

describe("meetings list", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = createMockMcpServer({
      list_meetings: (args) => MOCK_MEETINGS,
    });
    port = await listen(server, 0);
    process.env.MCP_URL = `http://localhost:${port}/mcp`;
    process.env.GRANOLA_TOKEN = "test-token";
  });

  afterAll(() => server.close());

  it("lists meetings in table format on TTY", async () => {
    const output = await runCli(["meetings", "list"]);
    expect(output.stdout).toContain("Test Meeting");
    expect(output.exitCode).toBe(0);
  });
});
```

---

## TypeScript Types

```typescript
// src/mcp/types.ts

export interface Meeting {
  id: string;
  title: string;
  start_time: string;  // ISO 8601
  end_time: string;    // ISO 8601
  attendees: Attendee[];
}

export interface Attendee {
  name: string;
  email?: string;
}

export interface MeetingDetail extends Meeting {
  notes?: string;
  private_notes?: string;
  raw_content?: string;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  start_time: string;
  end_time: string;
}

export interface Transcript {
  meeting_id: string;
  segments: TranscriptSegment[];
}

export interface QueryResult {
  question: string;
  answer: string;
  citations?: Array<{ meeting_id: string; title: string }>;
}
```

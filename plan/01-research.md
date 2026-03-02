# Research: Granola MCP API & Protocol Background

## Overview

This document captures research into the Granola AI meeting notes product, its public MCP server, the Model Context Protocol specification, and the philosophy behind building CLIs over MCPs. It serves as the foundational context for all subsequent design decisions.

---

## Granola AI & Meeting Notes

Granola is an AI-powered meeting notes product that records, transcribes, and summarizes meetings. It provides:

- **Automatic transcription** of meetings from audio
- **AI-enhanced notes** that combine raw transcript with structured summaries, action items, and key points
- **Private note layers** where users can annotate meetings with personal context
- **Cross-meeting querying** via natural language (e.g., "What did we decide about the API redesign last week?")

Granola exposes its data through a **public MCP server** at:

```
https://mcp.granola.ai/mcp
```

This server implements the Model Context Protocol using the **Streamable HTTP transport**, meaning it accepts JSON-RPC requests over HTTPS POST and may return streaming responses via Server-Sent Events (SSE).

---

## Granola MCP Server: Available Tools

The Granola MCP server exposes four primary tools:

### `list_meetings`

Lists meetings from the authenticated user's Granola account.

**Parameters:**

| Parameter  | Type   | Required | Description                                   |
|------------|--------|----------|-----------------------------------------------|
| `since`    | string | No       | ISO 8601 datetime — return meetings after this |
| `until`    | string | No       | ISO 8601 datetime — return meetings before this |
| `attendee` | string | No       | Filter by attendee name or email              |
| `limit`    | number | No       | Max results to return (default: 20)           |

**Returns:** Array of meeting summary objects containing `id`, `title`, `start_time`, `end_time`, `attendees[]`.

---

### `get_meetings`

Retrieves full meeting content including enhanced AI notes and private annotations.

**Parameters:**

| Parameter       | Type    | Required | Description                              |
|-----------------|---------|----------|------------------------------------------|
| `id`            | string  | Yes      | Meeting ID                               |
| `include_private` | boolean | No   | Include private notes (default: true)    |
| `include_enhanced` | boolean | No  | Include AI-enhanced notes (default: true)|

**Returns:** Full meeting object with `title`, `start_time`, `end_time`, `attendees[]`, `notes` (enhanced), `private_notes`, `raw_content`.

---

### `get_meeting_transcript`

Returns the raw transcript for a meeting. This is a **paid feature** — the server will return an appropriate error for users without transcript access.

**Parameters:**

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `id`      | string | Yes      | Meeting ID  |

**Returns:** Transcript object with `segments[]`, each containing `speaker`, `text`, `start_time`, `end_time`.

---

### `query_granola_meetings`

Performs a natural language query across all of the user's meetings, powered by Granola's AI backend. This call may take up to 60 seconds as it involves retrieval + generation.

**Parameters:**

| Parameter  | Type   | Required | Description               |
|------------|--------|----------|---------------------------|
| `question` | string | Yes      | Natural language question |

**Returns:** A natural language answer string, potentially with citations to specific meetings.

---

## Model Context Protocol (MCP) Specification

MCP is an open protocol (published by Anthropic, now community-governed) that standardizes how AI hosts (LLMs, agent frameworks) communicate with context-providing servers. Think of it as "HTTP for AI tools."

### Protocol Version

The Granola MCP server implements **MCP 2025-03-26** (the Streamable HTTP transport revision).

### Transport: Streamable HTTP

The Streamable HTTP transport replaced the older HTTP+SSE transport. Key characteristics:

- **Single endpoint:** All requests go to one URL (e.g., `https://mcp.granola.ai/mcp`)
- **JSON-RPC 2.0 over HTTPS POST:** Request bodies are JSON-RPC 2.0 messages
- **SSE for streaming:** The server may respond with `Content-Type: text/event-stream` when the response is a stream
- **Session management:** The server issues an `Mcp-Session-Id` header after `initialize`; clients must echo it on all subsequent requests
- **Resumability:** Clients can reconnect and resume a session using the session ID

### MCP Message Lifecycle

```
Client                                    Server
  │                                          │
  │── POST /mcp (InitializeRequest) ────────►│
  │◄─ 200 OK + Mcp-Session-Id ──────────────│
  │                                          │
  │── POST /mcp (tools/list) ───────────────►│
  │◄─ 200 OK (array of tool definitions) ───│
  │                                          │
  │── POST /mcp (tools/call) ───────────────►│
  │◄─ 200 OK or SSE stream ─────────────────│
  │                                          │
  │── POST /mcp (notifications/cancelled) ──►│  (optional)
```

### Tool Call JSON-RPC Shape

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list_meetings",
    "arguments": {
      "since": "2026-02-01T00:00:00Z",
      "limit": 10
    }
  }
}
```

### Tool Result Shape

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "[{\"id\": \"...\", \"title\": \"...\", ...}]"
      }
    ],
    "isError": false
  }
}
```

Note: The `content` field is always an array of content blocks. For the Granola server, results are typically a single `text` block containing JSON.

### SDK: `@modelcontextprotocol/sdk`

The official TypeScript/JavaScript SDK (`@modelcontextprotocol/sdk`) is the reference implementation. It provides:

- `StreamableHTTPClientTransport` — handles HTTPS POST, SSE parsing, session header management
- `Client` — high-level wrapper; sends `initialize`, maintains session, exposes `callTool()`, `listTools()`
- Automatic JSON-RPC ID generation and response matching

Using the SDK means we do **not** need to implement:
- JSON-RPC 2.0 framing
- SSE parsing
- `Mcp-Session-Id` header injection
- Session resumability

This is significant — reimplementing these correctly is error-prone and time-consuming.

---

## The CLI-over-MCP Philosophy

Peter Steinberger (iOS/Apple developer, PSPDFKit/PDF.ai founder, recently joined OpenAI to work on agents) has become widely cited for the observation:

> *"Almost all MCPs really should be CLIs."*

### The Token Cost Problem

Every time an AI agent is invoked with MCP server access, the agent framework must load that server's tool definitions into the context window. For a typical MCP server:

- **Small server (3–5 tools):** ~5k–10k tokens per invocation
- **Medium server (10–20 tools):** ~15k–25k tokens per invocation
- **Large server (30+ tools):** ~30k–50k tokens per invocation

For the Granola MCP server specifically, tool definitions (including descriptions, parameter schemas, and examples) consume approximately **23k–50k tokens** per agent invocation.

At scale — an agent running 100 tasks/day with MCP context — this represents a significant cost and latency overhead. Multiply across teams and it compounds quickly.

### Why CLIs Have Zero Overhead

AI agents — LLMs in particular — already have strong, built-in knowledge of how to use shell commands. They understand:

- Argument parsing conventions (`--flag value`, positional args)
- Exit codes (0 = success, non-zero = failure)
- Stdout vs stderr
- JSON output piping (`granola meetings list | jq .`)
- `--help` for self-documentation

A CLI has **zero context overhead** because the agent uses its training knowledge. The agent doesn't need to read the OpenAPI spec or MCP tool definitions at runtime — it can reason from `--help` output or even just from the command name and typical conventions.

### Composability

CLIs integrate naturally with the Unix philosophy:

```bash
# Pipe into jq for filtering
granola meetings list --since "last week" | jq '[.[] | select(.attendees | any(.name == "Alice"))]'

# Use in shell scripts
for id in $(granola meetings list --format json | jq -r '.[].id'); do
  granola meetings get "$id" --format markdown >> all-meetings.md
done

# CI pipeline integration
granola query "any action items from yesterday's standup?" >> $GITHUB_STEP_SUMMARY
```

MCP servers require an MCP-aware client; CLIs work with any shell, script, or CI runner.

### Dual-Use: Human + AI Agent

A CLI is simultaneously:

1. **Human-friendly:** Tab completion, `--help`, colored output, interactive prompts
2. **Agent-friendly:** Predictable JSON output when piped, stable argument interface, exit codes for flow control

An MCP server is only agent-friendly. Building the CLI first means humans can use it directly, which also makes it easier to test and debug.

### Summary Comparison

| Aspect              | MCP Server         | CLI                        |
|---------------------|--------------------|----------------------------|
| Token overhead      | 23k–50k per call   | 0                          |
| Agent compatibility | MCP-aware only     | Any shell/agent            |
| Human usability     | Poor               | Excellent                  |
| Shell scripting     | Not possible       | Native                     |
| CI integration      | Complex            | Trivial                    |
| Self-documentation  | Requires tool load | `--help`                   |
| Composability       | Limited            | Unix pipes, xargs, etc.    |

---

## Related Prior Art

- **`gh` (GitHub CLI)** — The gold standard for API-backed CLIs. Noun-verb subcommands (`gh pr list`, `gh issue create`), JSON-when-piped output, `--format` flag. `granola` deliberately mirrors this pattern.
- **`docker` CLI** — Another exemplar: `docker container ls`, structured JSON output with `--format`, exit codes as first-class API.
- **`stripe` CLI** — Demonstrates OAuth device flow + token storage in a developer tool.
- **`wrangler` (Cloudflare)** — TypeScript CLI with similar auth patterns.

---

## Open Questions & Assumptions

| Question | Assumption |
|----------|------------|
| Does `mcp.granola.ai` support Dynamic Client Registration (DCR)? | Yes — assumed based on MCP OAuth 2.1 spec requirement |
| Is the `/.well-known/oauth-authorization-server` endpoint present? | May return 404; fall back to convention-based defaults |
| Are there rate limits on the MCP endpoint? | Assumed yes; implement 429 + `Retry-After` handling |
| Does `query_granola_meetings` stream its response? | Assumed yes (SSE); SDK handles transparently |
| Is `get_meeting_transcript` gated by subscription tier? | Yes per product docs; surface as a clear error to users |

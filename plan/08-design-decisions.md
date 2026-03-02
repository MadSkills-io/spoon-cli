# Design Decisions

## Overview

This document provides extended rationale for the ten key design decisions made in building the Granola CLI. Each decision involves a real tradeoff; this document captures the reasoning so that future contributors (human and AI) understand *why* things are the way they are — and can make informed decisions when diverging from these choices makes sense.

---

## Decision 1: CLI Over MCP Server

**Decision:** Build a CLI that wraps the Granola MCP server, rather than distributing the MCP server directly to users.

**Context:** Granola's data is accessible via a public MCP server at `https://mcp.granola.ai/mcp`. It would be simpler to simply tell users to add this server URL to their AI agent's MCP configuration. Why add a CLI layer?

**Rationale:**

The core insight, articulated by Peter Steinberger (iOS/Apple developer, PSPDFKit/PDF.ai founder, recent OpenAI agent researcher):

> *"Almost all MCPs really should be CLIs."*

The reason is **token overhead**. Every time an AI agent invokes a tool via MCP, the agent framework must load the server's tool definitions into its context window. For the Granola MCP server, this costs 23k–50k tokens *per agent invocation*. At $15/million tokens, a team running 100 agent tasks per day spends ~$1–$3/day just on MCP metadata loading — before any actual work is done.

A CLI has **zero context overhead** because LLMs already have strong training knowledge of shell command conventions. They can use `granola meetings list --help` to self-document, or reason from the command name and standard patterns.

Additional advantages:
- **Composability:** CLIs compose naturally with Unix pipes, `xargs`, `jq`, shell scripts, CI systems. MCP requires an MCP-aware runtime.
- **Human usability:** Humans can use the CLI directly without any AI agent framework. The MCP server is not human-usable.
- **CI/CD integration:** `GRANOLA_TOKEN=... granola meetings list` works in any CI runner without additional configuration.
- **Debuggability:** Shell commands are easy to debug, log, and replay. MCP sessions are opaque.
- **Single implementation:** One CLI serves human users, shell scripts, AI agents, and CI pipelines.

**Tradeoff accepted:** Building the CLI adds ~1 week of development vs. "just use the MCP server directly." This is paid back quickly in token savings for heavy users.

---

## Decision 2: TypeScript / Node.js 20+

**Decision:** Implement in TypeScript, targeting Node.js 20, using ESM modules.

**Alternatives considered:**
- **Go** — Produces single static binaries; no runtime required. Rejected because the `@modelcontextprotocol/sdk` is TypeScript-native and there is no official Go MCP SDK. Reimplementing Streamable HTTP transport in Go would cost weeks.
- **Python** — Large runtime; slow startup (~500ms vs ~50ms for Node.js); Python MCP SDK exists but is less mature than TypeScript's.
- **Bun** — Faster startup, better TypeScript support. Rejected as primary target because Bun's Node.js compatibility is ~95%, not 100%; `keytar` (native module) has issues. Note: Phase 4 includes optional standalone binary compilation via `bun build --compile`.
- **Deno** — Good TypeScript support, but npm package compatibility requires a permissions wrapper; `keytar` doesn't work.

**Why TypeScript / Node.js:**
- `@modelcontextprotocol/sdk` is TypeScript-native; it's the official reference implementation
- Node.js 20+ has native `fetch`, eliminating HTTP library dependencies
- ESM modules (`"type": "module"`) are now fully supported in Node.js 20
- TypeScript strict mode catches errors at compile time that would be runtime bugs
- `pnpm` + `tsup` provide a fast, efficient build pipeline
- Node.js has the most mature ecosystem for native addons like `keytar`

**ESM-specific considerations:**
- All imports use `.js` extensions (required for ESM)
- `tsup` handles ESM bundling correctly
- `vitest` supports ESM natively; Jest would require transform configuration

---

## Decision 3: `commander` as CLI Framework

**Decision:** Use `commander` for argument parsing and subcommand management.

**Alternatives considered:**

| Framework | Pros | Cons |
|-----------|------|------|
| `commander` | Lightweight, mature, excellent TypeScript types, auto-generates `--help`, subcommands | Less opinionated (you write more boilerplate) |
| `oclif` | Full framework: plugins, hooks, auto-update | Heavy (10+ deps); generates excessive boilerplate; opinionated project structure |
| `yargs` | Flexible, powerful | API is harder to TypeScript-type correctly; older design |
| `meow` | Very lightweight | No subcommand support; too minimal for this complexity |
| `ink` | React-based terminal UI | Overkill; adds React as a dependency; not needed |
| `caporal` | Type-safe CLI framework | Smaller ecosystem; less community validation |

**Why `commander`:**
- Industry standard for Node.js CLIs (used by `create-react-app`, Webpack CLI, many others)
- Auto-generates `--help` output that is clean and readable
- Subcommand trees map directly to the noun-verb structure (`granola meetings list`)
- TypeScript types are excellent (`.option<T>()` with parsers)
- No framework lock-in: if we outgrow it, migration is straightforward
- Zero runtime overhead vs. `oclif`'s plugin loading

**Tradeoff accepted:** More boilerplate per command vs. `oclif`. This is acceptable for a focused tool with a fixed number of commands.

---

## Decision 4: Official MCP SDK (`@modelcontextprotocol/sdk`)

**Decision:** Use the official `@modelcontextprotocol/sdk` for all MCP transport concerns rather than implementing a custom HTTP client.

**What the SDK provides:**
- `StreamableHTTPClientTransport` — handles all Streamable HTTP protocol details
- JSON-RPC 2.0 message framing, ID generation, response matching
- SSE (Server-Sent Events) stream parsing
- `Mcp-Session-Id` header management and echoing
- Session resumability
- `Client` class with `connect()`, `callTool()`, `listTools()` methods

**Why not implement it ourselves:**

The Streamable HTTP transport for MCP is non-trivial to implement correctly:

1. **SSE parsing** for streaming responses requires handling chunked transfer encoding, event parsing, reconnection logic
2. **Session management** requires tracking the `Mcp-Session-Id` header and including it on every request
3. **Protocol negotiation** (`initialize` handshake, capability exchange) must happen before any tool calls
4. **JSON-RPC ID tracking** requires pairing async responses to requests

Getting any of these wrong causes subtle bugs that are hard to diagnose. The official SDK is the reference implementation, tested against the actual Granola server.

**Tradeoff accepted:** The SDK adds a dependency and some API constraints. Specifically, we can't directly control every HTTP header the SDK sends. This is acceptable — the SDK's behavior is correct and well-tested.

---

## Decision 5: JSON When Piped, Table When TTY

**Decision:** Default output format is determined by `process.stdout.isTTY` — table/text for interactive terminals, JSON for piped output.

**Prior art:** This pattern is established by modern developer CLIs:
- `gh pr list` — table in TTY, can pipe to `jq`
- `docker container ls` — table in TTY
- `kubectl get pods` — table in TTY, `--output json` for machines

**Why automatic detection:**

When a human runs `granola meetings list` in a terminal, they want a readable table. When a script runs `granola meetings list | jq '.[0].id'`, it needs parseable JSON. The same binary should serve both use cases without requiring the human to add `--format table` or the script to add `--format json`.

`process.stdout.isTTY` reliably distinguishes these cases:
- `true`: stdout is connected to a terminal (human is reading)
- `false`/`undefined`: stdout is piped, redirected, or in a CI environment (machine is reading)

**The `--format` override:** The explicit `--format` flag always takes precedence. This allows humans to get JSON (`granola meetings list --format json > data.json`) and scripts to get tables when needed.

**Tradeoff accepted:** Automatic detection can surprise users when first encountered. Mitigated by clear documentation and the `--format` override.

---

## Decision 6: Keychain + File Fallback for Token Storage

**Decision:** Use `keytar` (OS keychain) as primary token storage, with `~/.granola/credentials.json` (chmod 0600) as fallback.

**Alternatives considered:**

| Storage Method | Security | Availability |
|----------------|----------|--------------|
| OS Keychain (keytar) | Best (OS-managed, encrypted) | macOS/Windows/Linux Desktop |
| Encrypted file | Good (only as strong as the key derivation) | Everywhere |
| Plaintext file (0600) | Acceptable (filesystem permissions) | Everywhere |
| Environment variable | Good for CI; bad for interactive use | Varies |
| `~/.netrc` | Poor (plaintext, single file for all credentials) | Everywhere |

**Why `keytar`:**
- On macOS: credentials stored in Keychain, protected by user's login password and/or Touch ID
- On Windows: credentials stored in Windows Credential Store, encrypted by DPAPI
- On Linux desktop: stored in GNOME Keyring or KDE Wallet via Secret Service D-Bus API
- Zero-effort for the user: no password to remember
- Standard approach used by `gh`, npm, VS Code

**Why file fallback:**
- `keytar` requires a native module (`.node` binary) which may fail to compile on some systems
- Headless Linux environments (Docker, CI) don't have a Secret Service daemon
- The fallback must work everywhere, so a file with strict permissions is the right choice
- `chmod 0600` means only the file owner can read or write it — equivalent security to a plaintext private key

**Why not encrypted file only:**
- Encrypting a file requires a key, which creates a chicken-and-egg problem (where do you store the encryption key?)
- `keytar` solves this at the OS level with no additional complexity

**Tradeoff accepted:** `keytar` is a native module; it must be marked as `external` in `tsup` and may require compilation from source in some environments. The fallback makes this non-blocking.

---

## Decision 7: Natural Language Dates via `chrono-node`

**Decision:** Accept natural language date strings for `--since` / `--until` flags using `chrono-node`.

**Examples of what this enables:**
```bash
granola meetings list --since "last Monday"
granola meetings list --since "2 weeks ago" --until "yesterday"
granola meetings list --since "January 1"
granola meetings list --since "start of last month"
```

**Why natural language dates:**

The primary motivation is **human usability**. Requiring users to type `--since 2026-02-23T00:00:00Z` is error-prone and forces mental arithmetic. "Last Monday" is unambiguous and immediately understood.

**Why it doesn't hurt AI agent usability:**

AI agents naturally produce ISO 8601 dates. An agent writing a shell command will write `--since 2026-02-23T00:00:00Z`, not `--since "last Monday"`. The `chrono-node` wrapper also passes through valid ISO 8601 strings unchanged.

**`chrono-node` vs. alternatives:**

| Library | Natural Language Support | ISO 8601 Support | Size |
|---------|--------------------------|------------------|------|
| `chrono-node` | Excellent | Yes (passes through) | ~50KB |
| `date-fns` | No | Yes | ~80KB |
| `dayjs` | No | Yes | ~7KB |
| `moment` | No | Yes | ~300KB (deprecated) |
| Custom regex | Poor | Limited | 0KB |

`chrono-node` is the best-in-class JavaScript library for natural language date parsing. It handles time zones, relative expressions, ambiguous dates, and partial dates correctly.

**Tradeoff accepted:** `chrono-node` is ~50KB and has no tree-shaking. For a CLI, bundle size is not a significant concern (it ships in `dist/`, not a browser bundle).

---

## Decision 8: Noun-Verb Subcommand Structure

**Decision:** Use `granola <noun> <verb>` structure (e.g., `granola meetings list`) rather than `granola <verb>-<noun>` (e.g., `granola list-meetings`).

**Alternatives considered:**

| Structure | Example | Notes |
|-----------|---------|-------|
| `noun verb` | `granola meetings list` | Mirrors `gh pr list`, `kubectl get pods` |
| `verb noun` | `granola list meetings` | Less common in modern CLIs |
| `verb-noun` | `granola list-meetings` | Flat; doesn't scale |
| `verb` only | `granola list` | Ambiguous when multiple resource types exist |

**Why noun-verb:**

1. **Mirrors modern CLI conventions:** `gh pr list`, `gh issue create`, `docker container ls`, `kubectl get pods` — all use noun-verb. Engineers already know this pattern.

2. **Scales to new resources:** Today we have `meetings`. Tomorrow we might add `granola recordings`, `granola contacts`, `granola workspaces`. With noun-verb, adding a new resource is `granola <new-noun> list/get/...` without polluting the top-level namespace.

3. **`--help` is organized:** `granola meetings --help` shows only meeting-related commands; `granola --help` shows the resource list.

4. **AI agent familiarity:** LLMs trained on `gh`, `kubectl`, `docker` output naturally produce noun-verb commands.

**Tradeoff accepted:** `granola meetings list` is three words vs. `granola ls` being two. The extra word is worth the structural clarity and future extensibility.

---

## Decision 9: `GRANOLA_TOKEN` Environment Variable Override

**Decision:** Support a `GRANOLA_TOKEN` environment variable that, when set, bypasses all OAuth logic and uses the provided token directly.

**Use cases:**
1. **CI/CD pipelines:** A token can be stored as a CI secret and injected at run time without a browser flow
2. **Docker containers:** No browser, no keychain, no Secret Service — env var is the only viable option
3. **Scripted testing:** Integration tests can inject a test token without mocking the entire OAuth flow
4. **Service accounts:** Long-lived tokens managed externally can be used directly

**Security model:**
- The env var name (`GRANOLA_TOKEN`) is conventional and recognizable
- Setting an env var with a shell assignment (`export GRANOLA_TOKEN=...`) does not appear in `ps aux` process arguments
- The token should be set from a secrets manager (e.g., `GRANOLA_TOKEN=$(vault kv get -field=token secret/granola)`) rather than hardcoded in scripts
- The CLI never logs or prints the token value; `--debug` output redacts it to `Bearer <redacted>`

**What `GRANOLA_TOKEN` does NOT do:**
- Does not trigger automatic refresh (if the token expires, the user must update the env var)
- Does not interact with `auth login` / `auth logout` (stored credentials and env var are independent)
- Does not validate the token format before use (the MCP server will return 401 if invalid)

**Tradeoff accepted:** If `GRANOLA_TOKEN` is set to an expired token, the user gets a 401 error rather than an automatic refresh prompt. This is intentional — in CI contexts, token management is the user's responsibility.

---

## Decision 10: Zero Required Configuration

**Decision:** The CLI should work with a single `granola auth login` and no additional setup. No config file required, no manual endpoint specification, no client ID to obtain.

**What this means in practice:**
- `client_id` is obtained automatically via DCR (no "register at developer.granola.ai first")
- OAuth endpoints are discovered automatically (no `mcp_url` config required to start)
- Credential storage is automatic (OS keychain with no user interaction)
- Default output format is automatically appropriate for the context (TTY detection)
- Default `--limit` of 20 is sensible without configuration

**Why this matters:**

New user experience without zero-required-config:
```
1. Visit developer.granola.ai
2. Register an application
3. Copy your client_id and client_secret
4. Create ~/.granola/config.json with the above values
5. Run `granola auth login`
```

New user experience with zero-required-config:
```
1. Run `granola auth login`
```

The difference in friction is significant. Developer tools that require upfront registration and configuration have lower adoption. The OAuth 2.1 + DCR specification was designed precisely to enable this pattern.

**How zero-config is achieved:**
- **DCR:** Client registers itself; no pre-provisioned `client_id`
- **Discovery:** OAuth endpoints found automatically from server metadata
- **Sensible defaults:** All flags have defaults; no required configuration file
- **PKCE:** No client secret needed (public client)
- **OS keychain:** No "where should I store my credentials?" decision

**Escape hatches:** Advanced users can override defaults:
- `GRANOLA_TOKEN` for headless/CI use
- `~/.granola/config.json` for custom MCP server URL or default limit
- All flags always accept explicit values that override auto-detection

**Tradeoff accepted:** Zero-config requires DCR support on the server side. If the Granola MCP server removes DCR support, we'd need to add client registration instructions. The current architecture makes this fallback easy to add.

---

## Summary Table

| # | Decision | Alternative Rejected | Key Reason |
|---|----------|---------------------|------------|
| 1 | CLI over MCP | Just distribute MCP server | Zero token overhead; human + AI usable; composable |
| 2 | TypeScript / Node.js 20 | Go, Python, Bun | MCP SDK is TypeScript-native; native `fetch`; ESM |
| 3 | `commander` | `oclif`, `yargs` | Right weight; auto-help; no framework lock-in |
| 4 | Official MCP SDK | Custom HTTP client | SDK handles transport complexity; battle-tested |
| 5 | JSON when piped, table when TTY | Always JSON or always table | Matches `gh`/`docker` patterns; serves both humans and agents |
| 6 | Keychain + file fallback | Encrypted file only | OS keychain is more secure; file fallback ensures universal availability |
| 7 | Natural language dates (`chrono-node`) | ISO 8601 only | Human usability; AI agents use ISO 8601 anyway |
| 8 | Noun-verb subcommands | Verb-first or flat | Mirrors `gh`, `kubectl`; scales to new resources |
| 9 | `GRANOLA_TOKEN` env var | `--token` flag | Env var not visible in `ps aux`; conventional for CI |
| 10 | Zero required config (DCR) | Pre-registered client ID | Single-step onboarding; lower friction = higher adoption |

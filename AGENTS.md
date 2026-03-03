# Granola CLI — AI Agent Conventions

## Project Overview
`granola-cli` is a command-line interface for querying Granola AI meeting notes via Granola's public MCP server (`https://mcp.granola.ai/mcp`).

## Tech Stack
- **Language:** TypeScript (ESM, Node.js 20+)
- **MCP Client:** `@modelcontextprotocol/sdk` (StreamableHTTPClientTransport)
- **CLI Framework:** `commander` (subcommand pattern)
- **Build:** `tsup` (esbuild-based)
- **Tests:** `vitest`
- **Package Manager:** `pnpm`

## Architecture
Four layers: CLI → Service → MCP Client → Auth. Each layer has a single responsibility.

## Conventions
- All source in `src/`, tests in `tests/`
- ESM only (`"type": "module"` in package.json)
- Strict TypeScript (`strict: true`)
- Error output always goes to stderr; data output to stdout
- Exit codes: 0=success, 1=general error, 2=auth error, 3=rate limited, 4=not found
- JSON output when piped (non-TTY); human-readable when interactive (TTY)
- `--format` flag always overrides auto-detection

## Commands
```
granola auth login|logout|status
granola meetings list [--since] [--until] [--attendee] [--limit]
granola meetings get <id> [--no-private] [--no-enhanced]
granola meetings transcript <id>
granola query "<question>" [--format]
granola sync <output-dir> [--since] [--force] [--no-transcripts] [--no-private] [--batch-size] [--delay] [--dry-run] [--format]
granola config
```

## Key Files
- `src/index.ts` — CLI entry point
- `src/mcp/client.ts` — MCP SDK wrapper
- `src/auth/oauth.ts` — OAuth 2.1 + PKCE + DCR flow
- `src/auth/token-store.ts` — Credential persistence
- `src/commands/` — Command implementations
- `src/commands/sync.ts` — Sync command (mirrors meetings to local Markdown files)
- `src/sync/state.ts` — Sync state persistence (`~/.granola/sync-state.json`)
- `src/sync/writer.ts` — Markdown file writer (meeting notes + transcripts)
- `src/utils/retry.ts` — `withRetry()` exponential-backoff utility for rate-limited calls
- `src/output/formatter.ts` — Output formatting

## Testing
- Unit tests alongside integration tests in `tests/`
- Mock MCP server in `tests/mcp/mock-server.ts`
- Run: `pnpm test` or `pnpm test:coverage`

## Build & Run
```bash
pnpm install
pnpm build
node dist/index.js --help
# or: pnpm link --global && granola --help
```

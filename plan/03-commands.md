# Commands: Full Reference

## Overview

The Granola CLI follows a **noun-verb** command structure modeled after `gh` (GitHub CLI): `granola <resource> <action>`. This pattern scales naturally as more resources are added and is intuitive to both humans and AI agents familiar with modern CLI conventions.

```
granola <command> [subcommand] [arguments] [flags]
```

---

## Global Flags

These flags are available on every command:

| Flag              | Description                                              | Default |
|-------------------|----------------------------------------------------------|---------|
| `--format <fmt>`  | Output format: `json`, `table`, `csv`, `markdown`, `text` | Auto (TTY detection) |
| `--no-color`      | Disable colored output                                   | false   |
| `--debug`         | Print verbose debug info including HTTP requests         | false   |
| `-h, --help`      | Show help for this command                               | —       |
| `-V, --version`   | Show CLI version                                         | —       |

---

## `granola auth`

Authentication management commands.

### `granola auth login`

Initiates the OAuth 2.1 browser-based authentication flow.

**Usage:**
```bash
granola auth login
```

**Behavior:**
1. Checks if a valid token already exists; if so, confirms and skips the flow
2. Performs OAuth 2.1 + PKCE + DCR (see `04-authentication.md` for full details)
3. Opens the default browser to the Granola authorization page
4. Waits up to 120 seconds for the user to complete authentication
5. Exchanges the authorization code for access + refresh tokens
6. Stores credentials in the OS keychain (or file fallback)

**Output (success):**
```
✓ Logged in as andy@example.com
  Token expires: 2026-03-09T00:00:00Z
```

**Output (already logged in):**
```
✓ Already logged in as andy@example.com
  Run `granola auth logout` first to switch accounts.
```

**Flags:** None

**Exit codes:**
- `0` — Successfully authenticated
- `2` — Authentication failed (user cancelled, timeout, server error)

---

### `granola auth logout`

Revokes the current OAuth token and removes stored credentials.

**Usage:**
```bash
granola auth logout
```

**Behavior:**
1. Loads the stored refresh token
2. Sends a revocation request to the OAuth server's revocation endpoint (if available)
3. Deletes credentials from the OS keychain / credential file
4. Deletes cached client registration from `~/.granola/client.json`

**Output:**
```
✓ Logged out. Credentials have been removed.
```

**Flags:** None

**Exit codes:**
- `0` — Successfully logged out
- `0` — Also returns 0 if not logged in (idempotent)

---

### `granola auth status`

Displays the current authentication state.

**Usage:**
```bash
granola auth status
```

**Output (authenticated):**
```
✓ Authenticated
  User:       andy@example.com
  Expires:    2026-03-09T00:00:00Z (in 6 days)
  Token type: Bearer
  Storage:    OS Keychain (keytar)
```

**Output (not authenticated):**
```
✗ Not authenticated
  Run `granola auth login` to authenticate.
```

**Output (`--format json`):**
```json
{
  "authenticated": true,
  "user": "andy@example.com",
  "expires_at": "2026-03-09T00:00:00Z",
  "expires_in_seconds": 518400,
  "token_type": "Bearer",
  "storage": "keychain"
}
```

**Flags:** None (inherits `--format`)

**Exit codes:**
- `0` — Authenticated
- `2` — Not authenticated

---

## `granola meetings`

Meeting data commands. All `meetings` subcommands require authentication.

### `granola meetings list`

Lists meetings from the authenticated user's Granola account.

**Usage:**
```bash
granola meetings list [flags]
```

**Flags:**

| Flag                  | Description                                            | Default |
|-----------------------|--------------------------------------------------------|---------|
| `--since <date>`      | Return meetings after this date (ISO 8601 or natural language) | None (all meetings) |
| `--until <date>`      | Return meetings before this date (ISO 8601 or natural language) | None |
| `--attendee <name>`   | Filter by attendee name or email                       | None |
| `--limit <n>`         | Maximum number of meetings to return                   | 20 |
| `--format <fmt>`      | Output format                                          | table (TTY) / json (piped) |

**Natural language date examples:**
```bash
granola meetings list --since "last Monday"
granola meetings list --since "2 weeks ago" --until "last Friday"
granola meetings list --since "January 1"
granola meetings list --since "yesterday" --attendee "alice@example.com"
```

**ISO 8601 date examples:**
```bash
granola meetings list --since 2026-02-01
granola meetings list --since 2026-02-01T09:00:00Z
```

**Output (table, TTY):**
```
┌──────────────────────────┬─────────────────────────────────────┬──────────────────────┬────────────┐
│ ID                       │ Title                               │ Date                 │ Attendees  │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────┼────────────┤
│ mtg_01abc123             │ Q1 Planning Session                 │ 2026-02-28 10:00 AM  │ 4          │
│ mtg_01def456             │ Engineering Standup                 │ 2026-02-27 09:15 AM  │ 6          │
│ mtg_01ghi789             │ Product Review                      │ 2026-02-26 02:00 PM  │ 3          │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────┴────────────┘
3 meetings
```

**Output (`--format json`):**
```json
[
  {
    "id": "mtg_01abc123",
    "title": "Q1 Planning Session",
    "start_time": "2026-02-28T10:00:00Z",
    "end_time": "2026-02-28T11:00:00Z",
    "attendees": [
      { "name": "Andy Hahn", "email": "andy@example.com" },
      { "name": "Alice Smith", "email": "alice@example.com" }
    ]
  }
]
```

**Exit codes:**
- `0` — Success (even if 0 meetings match)
- `2` — Not authenticated
- `3` — Rate limited
- `1` — Other error

---

### `granola meetings get <id>`

Retrieves the full content of a single meeting, including AI-enhanced notes and private annotations.

**Usage:**
```bash
granola meetings get <meeting-id> [flags]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>`   | Meeting ID (from `meetings list`) |

**Flags:**

| Flag              | Description                                       | Default |
|-------------------|---------------------------------------------------|---------|
| `--no-private`    | Exclude private notes from output                 | false   |
| `--no-enhanced`   | Exclude AI-enhanced notes; show raw content only  | false   |
| `--format <fmt>`  | Output format                                     | text (TTY) / json (piped) |

**Examples:**
```bash
# Get a meeting with all content (default)
granola meetings get mtg_01abc123

# Get without private notes
granola meetings get mtg_01abc123 --no-private

# Get as JSON for programmatic use
granola meetings get mtg_01abc123 --format json

# Get as markdown for export
granola meetings get mtg_01abc123 --format markdown > meeting.md
```

**Output (text, TTY):**
```
Q1 Planning Session
───────────────────
Date:      2026-02-28 10:00 AM – 11:00 AM
Attendees: Andy Hahn, Alice Smith, Bob Jones, Carol White

NOTES
─────
## Agenda
1. Review Q1 OKRs
2. Resource allocation
3. Open issues

## Key Decisions
- Prioritize the API v2 launch over the mobile app refresh
- Hire 2 additional engineers in Q2

## Action Items
- [ ] Andy: Draft API v2 spec by March 7
- [ ] Alice: Send hiring brief to recruiter
```

**Exit codes:**
- `0` — Success
- `2` — Not authenticated
- `4` — Meeting not found
- `1` — Other error

---

### `granola meetings transcript <id>`

Retrieves the raw speaker-attributed transcript for a meeting. **This is a paid feature.**

**Usage:**
```bash
granola meetings transcript <meeting-id> [flags]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>`   | Meeting ID |

**Flags:**

| Flag             | Description         | Default |
|------------------|---------------------|---------|
| `--format <fmt>` | Output format       | text (TTY) / json (piped) |

**Examples:**
```bash
# Print transcript to terminal
granola meetings transcript mtg_01abc123

# Export as JSON
granola meetings transcript mtg_01abc123 --format json > transcript.json

# Search transcript with grep
granola meetings transcript mtg_01abc123 --format text | grep -i "action item"
```

**Output (text, TTY):**
```
Q1 Planning Session — Transcript
──────────────────────────────────
[10:00:12] Andy Hahn: Alright, let's get started. Today we're reviewing our Q1 OKRs.
[10:00:45] Alice Smith: Before we dive in, I want to flag that our API timeline has slipped.
[10:01:03] Andy Hahn: Good point. Let's put that at the top of the agenda.
...
```

**Output (`--format json`):**
```json
{
  "meeting_id": "mtg_01abc123",
  "segments": [
    {
      "speaker": "Andy Hahn",
      "text": "Alright, let's get started. Today we're reviewing our Q1 OKRs.",
      "start_time": "2026-02-28T10:00:12Z",
      "end_time": "2026-02-28T10:00:44Z"
    }
  ]
}
```

**Error (not subscribed):**
```
✗ Transcript access requires a paid Granola subscription.
  Visit https://granola.ai/pricing to upgrade.
```

**Exit codes:**
- `0` — Success
- `2` — Not authenticated
- `4` — Meeting not found / transcript unavailable
- `1` — Subscription required or other error

---

## `granola query`

Performs a natural language query across all of the user's meetings using Granola's AI backend.

**Usage:**
```bash
granola query "<question>" [flags]
```

**Arguments:**

| Argument      | Description                    |
|---------------|--------------------------------|
| `<question>`  | Natural language question (quoted string) |

**Flags:**

| Flag             | Description                               | Default |
|------------------|-------------------------------------------|---------|
| `--format <fmt>` | Output format: `json`, `text`             | text (TTY) / json (piped) |

**Timeout:** This command uses a 60-second timeout (vs 30s for other commands) because it involves AI generation on the server side.

**Examples:**
```bash
# Ask a question about your meetings
granola query "What were the key decisions from last week's planning meetings?"

# Find action items
granola query "What action items were assigned to me in the last month?"

# Use in a shell script
SUMMARY=$(granola query "Summarize all meetings from this week")
echo "$SUMMARY" >> weekly-report.md

# Get structured JSON for programmatic use
granola query "What topics came up most in Q1?" --format json
```

**Output (text, TTY):**
```
Based on your meetings from last week:

**Q1 Planning Session (Feb 28)**
The team decided to prioritize the API v2 launch over the mobile app refresh. Andy
was assigned to draft the API v2 spec by March 7.

**Engineering Standup (Feb 27)**
The team discussed the CI pipeline slowdown. Bob agreed to investigate the test
suite performance.

Key decisions: API v2 prioritized, 2 new engineering hires approved for Q2.
```

**Output (`--format json`):**
```json
{
  "question": "What were the key decisions from last week's planning meetings?",
  "answer": "Based on your meetings from last week:\n\n...",
  "citations": [
    { "meeting_id": "mtg_01abc123", "title": "Q1 Planning Session" }
  ]
}
```

**Exit codes:**
- `0` — Success
- `2` — Not authenticated
- `3` — Rate limited
- `1` — Other error (timeout, server error)

---

## `granola config`

Displays the current CLI configuration.

**Usage:**
```bash
granola config [flags]
```

**Output (TTY):**
```
Granola CLI Configuration
─────────────────────────
Config file:  ~/.granola/config.json
Credentials:  OS Keychain (keytar)
Client reg:   ~/.granola/client.json
MCP server:   https://mcp.granola.ai/mcp
Default limit: 20
```

**Output (`--format json`):**
```json
{
  "config_file": "/Users/andy/.granola/config.json",
  "credential_storage": "keychain",
  "client_registration": "/Users/andy/.granola/client.json",
  "mcp_server": "https://mcp.granola.ai/mcp",
  "default_limit": 20
}
```

**Exit codes:**
- `0` — Always succeeds

---

## Exit Codes Reference

| Code | Meaning | Example Scenario |
|------|---------|-----------------|
| `0`  | Success | Command completed successfully |
| `1`  | General error | Network failure, unexpected server error, timeout |
| `2`  | Auth error | Not logged in, token expired, refresh failed |
| `3`  | Rate limited | 429 response after all retries exhausted |
| `4`  | Not found | Meeting ID does not exist |

**Shell script usage:**
```bash
granola meetings list --format json > meetings.json
if [ $? -eq 2 ]; then
  echo "Not authenticated — running granola auth login"
  granola auth login
fi
```

---

## Output Format Reference

### TTY vs Piped Behavior

```bash
# TTY (interactive) — renders table
granola meetings list

# Piped — automatically emits JSON
granola meetings list | jq '.[0].title'

# Explicit override
granola meetings list --format csv > meetings.csv
granola meetings list --format json | python3 -c "import sys,json; ..."
```

### Format Availability by Command

| Command                   | json | table | csv | markdown | text |
|---------------------------|------|-------|-----|----------|------|
| `auth status`             | ✓    | —     | —   | —        | ✓    |
| `meetings list`           | ✓    | ✓     | ✓   | ✓        | —    |
| `meetings get`            | ✓    | —     | —   | ✓        | ✓    |
| `meetings transcript`     | ✓    | —     | —   | —        | ✓    |
| `query`                   | ✓    | —     | —   | —        | ✓    |
| `config`                  | ✓    | —     | —   | —        | ✓    |

---

## AI Agent Usage Notes

When used by an AI agent, the CLI behaves predictably:

- **JSON by default when piped:** No `--format json` flag needed in most shell integrations
- **Exit codes as flow control:** Agents can check `$?` to handle auth failures vs not-found vs rate limits differently
- **`--help` is self-documenting:** Agents unfamiliar with a flag can run `granola meetings list --help` to discover options
- **ISO 8601 dates work directly:** Agents don't need `chrono-node`; they can pass `--since 2026-02-01T00:00:00Z` directly

**Example agent workflow:**
```bash
# Step 1: Check auth
granola auth status --format json | jq -e '.authenticated' || granola auth login

# Step 2: List recent meetings
MEETINGS=$(granola meetings list --since "$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)" --format json)

# Step 3: Get full content of the first meeting
FIRST_ID=$(echo "$MEETINGS" | jq -r '.[0].id')
granola meetings get "$FIRST_ID" --format json
```

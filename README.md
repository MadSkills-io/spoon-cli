# granola-cli

A command-line interface for querying [Granola](https://granola.ai) AI meeting notes via Granola's MCP server.

```
$ granola meetings list --since "last week"
$ granola query "What action items came out of this week's standups?"
$ granola meetings get abc123 --format markdown
$ granola sync ./meetings
```

## Installation

```bash
npm install -g granola-cli
```

Or run without installing:

```bash
npx granola-cli --help
```

## Running from source

Clone the repo and run directly without publishing to npm:

```bash
git clone https://github.com/your-org/granola-cli.git
cd granola-cli
pnpm install
pnpm build
node dist/index.js --help
```

To use `granola` as a global command from your local checkout:

```bash
pnpm link --global
granola --help
```

To unlink later:

```bash
pnpm unlink --global granola-cli
```

## Authentication

Granola uses OAuth 2.1. Run this once to authenticate:

```bash
granola auth login
```

Your browser will open for sign-in. The token is stored in `~/.granola/credentials.json` and refreshes automatically.

```bash
granola auth status    # check authentication state
granola auth logout    # revoke and clear credentials
```

**CI / headless environments:** Set `GRANOLA_TOKEN=<token>` to skip the OAuth flow entirely.

## Commands

### `granola meetings list`

List your meetings.

```
Options:
  --since <date>     Show meetings since date (ISO 8601 or natural language)
  --until <date>     Show meetings until date (ISO 8601 or natural language)
  --attendee <name>  Filter by attendee name or email
  --limit <n>        Maximum number of meetings to return (default: 20)
  --format <format>  json | table | csv | markdown | text
```

```bash
granola meetings list
granola meetings list --since "last week"
granola meetings list --since 2024-01-01 --until 2024-02-01
granola meetings list --attendee "Sarah" --limit 5
granola meetings list --since "2 days ago" --format csv

# Pipe to jq
granola meetings list --format json | jq '.[].title'
granola meetings list --format json | jq '.[0].id'
```

### `granola meetings get <id>`

Get the full content of a meeting by ID.

```
Options:
  --no-private       Exclude private notes
  --no-enhanced      Exclude AI-enhanced notes
  --format <format>  json | table | csv | markdown | text
```

```bash
granola meetings get abc123
granola meetings get abc123 --format markdown
granola meetings get abc123 --no-private --format json

# Pipe a meeting ID from list
granola meetings list --format json | jq -r '.[0].id' | xargs granola meetings get
```

### `granola meetings transcript <id>`

Get the raw word-for-word transcript of a meeting. Requires a Granola paid plan.

```bash
granola meetings transcript abc123
granola meetings transcript abc123 --format json
```

### `granola query "<question>"`

Ask a natural language question across all your meetings.

```
Options:
  --format <format>  json | table | text
```

```bash
granola query "What action items came out of this week's standups?"
granola query "What did Sarah say about the Q4 roadmap?"
granola query "Summarize all meetings from last week"
granola query "Who mentioned the budget?" --format json
```

### `granola sync <output-dir>`

Mirror Granola meeting notes and transcripts to a local directory as Markdown files with YAML front-matter. Supports incremental sync — only fetches meetings since the last run.

```
Options:
  --since <date>      Override incremental sync; start from this date
  --force             Re-sync all meetings (ignores last-run state)
  --no-transcripts    Skip transcript fetching
  --no-private        Exclude private notes from meeting files
  --batch-size <n>    IDs per get_meetings call (default: 5)
  --delay <ms>        Delay between MCP calls in ms (default: 200)
  --dry-run           List meetings that would sync, don't write files
  --format <fmt>      Progress output format: text, json
```

```bash
# Sync all meetings to a local directory
granola sync ./meetings

# Sync only meetings from last week
granola sync ./meetings --since "last week"

# Preview what would be synced
granola sync ./meetings --dry-run

# Re-sync everything, overwriting existing files
granola sync ./meetings --force

# Skip transcripts and private notes
granola sync ./meetings --no-transcripts --no-private

# Slow down requests to avoid rate limiting
granola sync ./meetings --delay 500
```

**Output layout:**

```
meetings/
  _unfiled/                              # meetings with no folder
    2024-01-16-standup.md
    2024-01-16-standup.transcript.md
  Planning/                              # one dir per Granola folder
    2024-01-15-q1-planning-session.md
    2024-01-15-q1-planning-session.transcript.md
```

Meeting files contain YAML front-matter (id, title, date, attendees, folders) followed by Summary, Notes, and Private Notes sections. Transcript files contain speaker-attributed, timestamped dialogue.

Sync state is persisted at `~/.granola/sync-state.json` — running `sync` again only fetches new meetings.

### `granola config`

Show the current configuration and file paths.

```bash
granola config
granola config --format json
```

## Output Formats

Output format is auto-detected based on context:

| Context | Default format |
|---------|---------------|
| Interactive terminal (TTY) | `table` / `text` with colors |
| Piped / redirected | `json` |
| `--format` flag | Always overrides |

Available formats for most commands: `json`, `table`, `csv`, `markdown`, `text`.

```bash
# Human-readable in terminal
granola meetings list

# JSON for scripting
granola meetings list --format json | jq '.[].title'

# CSV for spreadsheets
granola meetings list --format csv > meetings.csv

# Markdown for notes
granola meetings get abc123 --format markdown > meeting.md
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Authentication error |
| `3` | Rate limited |
| `4` | Not found |

Errors are written to **stderr** — as JSON when piped, colored text when interactive:

```bash
# Structured error on stderr when piped
granola meetings list 2>&1 | jq .error
# → "auth_error"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GRANOLA_TOKEN` | Bearer token — skips OAuth entirely (useful for CI) |
| `NO_COLOR` | Disable colored output ([no-color.org](https://no-color.org)) |

```bash
GRANOLA_TOKEN=eyJ... granola meetings list
```

## Scripting & AI Agent Usage

`granola` outputs JSON when piped, making it easy to compose with other tools:

```bash
# Get all meeting IDs from last week
granola meetings list --since "last week" --format json | jq -r '.[].id'

# Export a meeting to markdown
granola meetings get abc123 --format markdown > standup-2024-01-15.md

# Find action items across all recent meetings
granola query "What are all the open action items?" | grep -i "TODO"

# Use in a shell script
ID=$(granola meetings list --format json | jq -r '.[0].id')
granola meetings transcript "$ID" --format json > transcript.json

# Mirror all meetings to local Markdown files
granola sync ~/granola-backup

# Incremental backup (only new meetings since last run)
granola sync ~/granola-backup --since "last week"
```

AI agents can discover all commands from `granola --help` with zero token overhead — no MCP tool definitions needed.

## Data & Credentials

All credentials and config are stored in `~/.granola/`:

```
~/.granola/
├── credentials.json   # Access + refresh tokens (chmod 0600)
├── client.json        # OAuth client registration (cached)
├── config.json        # CLI preferences
├── discovery.json     # OAuth server metadata (cached)
└── sync-state.json    # Incremental sync state (last run, synced meeting IDs)
```

## Requirements

- Node.js 20+
- A [Granola](https://granola.ai) account

## License

MIT

# spoon

> a cli tool to consume your granola

`spoon` is an unofficial command-line interface for [Granola](https://granola.ai) AI meeting notes, built on Granola's public MCP server.

```
$ spoon meetings list --since "last week"
$ spoon query "What action items came out of this week's standups?"
$ spoon meetings get abc123 --format markdown
$ spoon sync ./meetings
```

> **Disclaimer:** This project is not affiliated with, endorsed by, or supported by Granola AI. "Granola" is a trademark of its respective owner. This is an independent, community-built tool that uses Granola's publicly available MCP API.

## Installation

```bash
npm install -g spoon-cli
```

Or run without installing:

```bash
npx spoon-cli --help
```

## Running from source

Clone the repo and run directly without publishing to npm:

```bash
git clone https://github.com/MadSkills-io/spoon-cli.git
cd spoon-cli
pnpm install
pnpm build
node dist/index.js --help
```

To use `spoon` as a global command from your local checkout:

```bash
pnpm link --global
spoon --help
```

To unlink later:

```bash
pnpm unlink --global spoon-cli
```

## Authentication

Granola uses OAuth 2.1. Run this once to authenticate:

```bash
spoon auth login
```

Your browser will open for sign-in. The token is stored in `~/.spoon/credentials.json` and refreshes automatically.

```bash
spoon auth status    # check authentication state
spoon auth logout    # revoke and clear credentials
```

**CI / headless environments:** Set `GRANOLA_TOKEN=<token>` to skip the OAuth flow entirely.

## Commands

### `spoon meetings list`

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
spoon meetings list
spoon meetings list --since "last week"
spoon meetings list --since 2024-01-01 --until 2024-02-01
spoon meetings list --attendee "Sarah" --limit 5
spoon meetings list --since "2 days ago" --format csv

# Pipe to jq
spoon meetings list --format json | jq '.[].title'
spoon meetings list --format json | jq '.[0].id'
```

### `spoon meetings get <id>`

Get the full content of a meeting by ID.

```
Options:
  --no-private       Exclude private notes
  --no-enhanced      Exclude AI-enhanced notes
  --format <format>  json | table | csv | markdown | text
```

```bash
spoon meetings get abc123
spoon meetings get abc123 --format markdown
spoon meetings get abc123 --no-private --format json

# Pipe a meeting ID from list
spoon meetings list --format json | jq -r '.[0].id' | xargs spoon meetings get
```

### `spoon meetings transcript <id>`

Get the raw word-for-word transcript of a meeting. Requires a Granola paid plan.

```bash
spoon meetings transcript abc123
spoon meetings transcript abc123 --format json
```

### `spoon query "<question>"`

Ask a natural language question across all your meetings.

```
Options:
  --format <format>  json | table | text
```

```bash
spoon query "What action items came out of this week's standups?"
spoon query "What did Sarah say about the Q4 roadmap?"
spoon query "Summarize all meetings from last week"
spoon query "Who mentioned the budget?" --format json
```

### `spoon sync <output-dir>`

Mirror Granola meeting notes and transcripts to a local directory as Markdown files with YAML front-matter. Supports incremental sync — only fetches meetings since the last run. Shows a live progress bar in interactive terminals.

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
spoon sync ./meetings

# Sync only meetings from last week
spoon sync ./meetings --since "last week"

# Preview what would be synced
spoon sync ./meetings --dry-run

# Re-sync everything, overwriting existing files
spoon sync ./meetings --force

# Skip transcripts and private notes
spoon sync ./meetings --no-transcripts --no-private

# Slow down requests to avoid rate limiting
spoon sync ./meetings --delay 500
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

Sync state is persisted at `~/.spoon/sync-state.json` — running `sync` again only fetches new meetings.

### `spoon config`

Show the current configuration and file paths.

```bash
spoon config
spoon config --format json
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
spoon meetings list

# JSON for scripting
spoon meetings list --format json | jq '.[].title'

# CSV for spreadsheets
spoon meetings list --format csv > meetings.csv

# Markdown for notes
spoon meetings get abc123 --format markdown > meeting.md
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
spoon meetings list 2>&1 | jq .error
# → "auth_error"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GRANOLA_TOKEN` | Bearer token — skips OAuth entirely (useful for CI) |
| `NO_COLOR` | Disable colored output ([no-color.org](https://no-color.org)) |

```bash
GRANOLA_TOKEN=eyJ... spoon meetings list
```

## Scripting & AI Agent Usage

`spoon` outputs JSON when piped, making it easy to compose with other tools:

```bash
# Get all meeting IDs from last week
spoon meetings list --since "last week" --format json | jq -r '.[].id'

# Export a meeting to markdown
spoon meetings get abc123 --format markdown > standup-2024-01-15.md

# Find action items across all recent meetings
spoon query "What are all the open action items?" | grep -i "TODO"

# Use in a shell script
ID=$(spoon meetings list --format json | jq -r '.[0].id')
spoon meetings transcript "$ID" --format json > transcript.json

# Mirror all meetings to local Markdown files
spoon sync ~/spoon-backup

# Incremental backup (only new meetings since last run)
spoon sync ~/spoon-backup --since "last week"
```

AI agents can discover all commands from `spoon --help` with zero token overhead — no MCP tool definitions needed.

## Data & Credentials

All credentials and config are stored in `~/.spoon/`:

```
~/.spoon/
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

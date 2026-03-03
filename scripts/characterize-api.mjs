#!/usr/bin/env node
/**
 * scripts/characterize-api.mjs
 *
 * Characterizes the rate limit behaviour of the Granola MCP API endpoints.
 * Run this before writing any throttling or retry logic, or when rate limit
 * symptoms change.
 *
 * Usage:
 *   node scripts/characterize-api.mjs [--endpoint <name>] [--gap <ms>]
 *
 * Options:
 *   --endpoint  Which endpoint to probe: list | get | transcript | all (default: all)
 *   --gap       Gap between calls in ms during the burst probe (default: 0)
 *   --meeting   Meeting ID to use for get/transcript probes (auto-detected if omitted)
 *   --calls     Number of calls to make in the burst probe (default: 10)
 *
 * Requires valid credentials in ~/.spoon/ (run `spoon auth login` first).
 *
 * Output:
 *   For each endpoint:
 *   - How many consecutive calls succeed before the first 429
 *   - Estimated rate limit window (by probing when it clears)
 *   - Whether spacing calls within the window helps
 *
 * Example:
 *   node scripts/characterize-api.mjs --endpoint transcript --calls 5
 *   node scripts/characterize-api.mjs --endpoint transcript --gap 5000
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config & auth
// ---------------------------------------------------------------------------

const SPOON_DIR = join(homedir(), ".spoon");

function loadTokens() {
  try {
    return JSON.parse(readFileSync(join(SPOON_DIR, "credentials.json"), "utf-8"));
  } catch {
    console.error("No credentials found. Run: spoon auth login");
    process.exit(1);
  }
}

function loadClientInfo() {
  try {
    return JSON.parse(readFileSync(join(SPOON_DIR, "client.json"), "utf-8"));
  } catch {
    return null;
  }
}

async function getAccessToken() {
  const tokens = loadTokens();
  if (!tokens.access_token) {
    console.error("No access token found. Run: spoon auth login");
    process.exit(1);
  }
  // Check expiry — if expired, try a token refresh via the stored refresh_token
  if (tokens.expires_at && new Date(tokens.expires_at) < new Date()) {
    if (!tokens.refresh_token) {
      console.error("Token expired and no refresh token available. Run: spoon auth login");
      process.exit(1);
    }
    console.log("Access token expired — attempting refresh...");
    const refreshed = await refreshToken(tokens.refresh_token);
    if (!refreshed) {
      console.error("Token refresh failed. Run: spoon auth login");
      process.exit(1);
    }
    return refreshed;
  }
  return tokens.access_token;
}

async function refreshToken(refreshToken) {
  try {
    const clientInfo = loadClientInfo();
    if (!clientInfo?.client_id) return null;

    // Discover token endpoint
    const disco = await fetch("https://mcp.granola.ai/.well-known/oauth-authorization-server");
    if (!disco.ok) return null;
    const meta = await disco.json();

    const resp = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientInfo.client_id,
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();

    // Persist the new tokens
    const credPath = join(SPOON_DIR, "credentials.json");
    const existing = loadTokens();
    const updated = {
      ...existing,
      access_token: data.access_token,
      expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(credPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
    console.log("Token refreshed successfully.\n");
    return data.access_token;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Raw MCP call (bypasses the app's client so we can control timing precisely)
// ---------------------------------------------------------------------------

const MCP_URL = "https://mcp.granola.ai/mcp";
let sessionId = null;

/**
 * Parse an MCP response — handles both plain JSON and SSE (text/event-stream)
 * formats since the server may return either depending on the Accept header.
 */
async function parseBody(resp) {
  const text = await resp.text();
  // SSE: lines like "data: {...}"
  const sseMatch = text.match(/^data:\s*(\{[\s\S]*?\})\s*$/m);
  if (sseMatch) return JSON.parse(sseMatch[1]);
  return JSON.parse(text);
}

async function mcpInit(token) {
  const resp = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${token}`,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "characterize-api", version: "1.0.0" },
      },
    }),
  });
  if (resp.headers.get("mcp-session-id")) {
    sessionId = resp.headers.get("mcp-session-id");
  }
  const body = await parseBody(resp).catch(() => null);
  if (!resp.ok || !body) {
    console.error(`MCP init failed (${resp.status}): ${JSON.stringify(body)?.slice(0, 120) ?? "no body"}`);
    return false;
  }
  // Success: result.serverInfo is present
  return !!body?.result?.serverInfo;
}

async function mcpCall(token, toolName, args = {}) {
  const start = Date.now();
  const resp = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${token}`,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  const elapsed = Date.now() - start;
  const body = await parseBody(resp).catch(() => ({ result: { isError: true, content: [{ text: `HTTP ${resp.status}` }] } }));
  const isError = body?.result?.isError ?? false;
  const content = body?.result?.content?.[0]?.text ?? "";
  const isRateLimit =
    resp.status === 429 ||
    (isError &&
      (content.toLowerCase().includes("rate limit") ||
        content.toLowerCase().includes("too many")));

  return { ok: resp.ok && !isError, isRateLimit, elapsed, status: resp.status, content };
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/**
 * Burst probe: make N calls back-to-back (with optional gap) and record
 * when the first 429 occurs.
 */
async function burstProbe(token, toolName, args, { calls, gap, label }) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`BURST PROBE: ${label} (${calls} calls, ${fmt(gap)} gap)`);
  console.log(`${"─".repeat(60)}`);

  let firstFailAt = null;
  let successCount = 0;

  for (let i = 0; i < calls; i++) {
    if (i > 0 && gap > 0) await sleep(gap);
    const result = await mcpCall(token, toolName, args);
    const status = result.isRateLimit ? "RATE_LIMITED" : result.ok ? "OK" : `ERR(${result.status})`;
    console.log(`  Call ${String(i + 1).padStart(2)}: ${status.padEnd(12)} ${fmt(result.elapsed)}`);

    if (result.ok) {
      successCount++;
    } else if (result.isRateLimit && firstFailAt === null) {
      firstFailAt = i;
    }
  }

  console.log(`\n  ✓ Succeeded: ${successCount}/${calls}`);
  if (firstFailAt !== null) {
    console.log(`  ✗ First 429 at call #${firstFailAt + 1} (after ${successCount} successes)`);
  } else {
    console.log(`  ✓ No rate limiting detected in this burst`);
  }

  return { successCount, firstFailAt };
}

/**
 * Window probe: after hitting a rate limit, poll until we get a success
 * to estimate the window length.
 */
async function windowProbe(token, toolName, args, { pollIntervalMs = 30_000, maxWaitMs = 15 * 60_000 }) {
  console.log(`\nWINDOW PROBE: polling every ${fmt(pollIntervalMs)} to find when limit clears...`);
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await sleep(pollIntervalMs);
    const elapsed = Date.now() - start;
    const result = await mcpCall(token, toolName, args);
    if (result.ok) {
      console.log(`  ✓ Rate limit cleared after ~${fmt(elapsed)}`);
      return elapsed;
    }
    console.log(`  ✗ Still rate limited at ${fmt(elapsed)}`);
  }

  console.log(`  ✗ Did not clear within ${fmt(maxWaitMs)} — window may be longer`);
  return null;
}

/**
 * Get a real meeting ID to use for get/transcript probes.
 */
async function getFirstMeetingId(token) {
  const result = await mcpCall(token, "list_meetings", {});
  if (!result.ok) {
    console.error("Could not list meetings:", result.content.slice(0, 100));
    return null;
  }
  // Parse the XML: <meeting id="...">
  const m = result.content.match(/<meeting\s+id="([^"]+)"/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    endpoint: "all",
    gap: 0,
    calls: 10,
    meeting: null,
    skipWindow: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--endpoint") opts.endpoint = args[++i];
    else if (args[i] === "--gap") opts.gap = parseInt(args[++i], 10);
    else if (args[i] === "--calls") opts.calls = parseInt(args[++i], 10);
    else if (args[i] === "--meeting") opts.meeting = args[++i];
    else if (args[i] === "--skip-window") opts.skipWindow = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Usage: node scripts/characterize-api.mjs [options]

Options:
  --endpoint <name>   Endpoint to probe: list | get | transcript | all (default: all)
  --gap <ms>          Gap between calls during burst probe (default: 0)
  --calls <n>         Number of calls in burst probe (default: 10)
  --meeting <id>      Meeting ID to use for get/transcript (auto-detected if omitted)
  --skip-window       Skip the window-length probe (faster, no long wait)
  -h, --help          Show this help

Examples:
  # Full characterization of all endpoints
  node scripts/characterize-api.mjs

  # Only probe transcript endpoint with 5s gaps
  node scripts/characterize-api.mjs --endpoint transcript --gap 5000

  # Quick burst test — skip the window probe
  node scripts/characterize-api.mjs --endpoint transcript --skip-window
      `);
      process.exit(0);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  console.log("=".repeat(60));
  console.log("  Granola MCP API Rate Limit Characterization");
  console.log("=".repeat(60));
  console.log(`  Endpoint: ${opts.endpoint}`);
  console.log(`  Gap:      ${fmt(opts.gap)}`);
  console.log(`  Calls:    ${opts.calls}`);
  console.log();

  const token = await getAccessToken();

  console.log("Initializing MCP session...");
  const ok = await mcpInit(token);
  if (!ok) {
    console.error("Failed to initialize MCP session");
    process.exit(1);
  }
  console.log("MCP session ready.\n");

  // Resolve meeting ID for get/transcript probes
  let meetingId = opts.meeting;
  if (!meetingId && (opts.endpoint === "get" || opts.endpoint === "transcript" || opts.endpoint === "all")) {
    console.log("Auto-detecting meeting ID...");
    meetingId = await getFirstMeetingId(token);
    if (!meetingId) {
      console.error("Could not find a meeting ID. Pass --meeting <id> explicitly.");
      process.exit(1);
    }
    console.log(`Using meeting ID: ${meetingId}\n`);
  }

  const summary = [];

  // --- list_meetings ---
  if (opts.endpoint === "list" || opts.endpoint === "all") {
    const { successCount, firstFailAt } = await burstProbe(token, "list_meetings", {}, {
      calls: opts.calls,
      gap: opts.gap,
      label: "list_meetings",
    });

    summary.push({
      endpoint: "list_meetings",
      burstLimit: firstFailAt !== null ? successCount : `>${opts.calls} (no limit detected)`,
      windowCleared: "n/a",
    });

    if (firstFailAt !== null && !opts.skipWindow) {
      const windowMs = await windowProbe(token, "list_meetings", {}, {});
      summary[summary.length - 1].windowCleared = windowMs ? fmt(windowMs) : "unknown (>15m)";
    }
  }

  // --- get_meetings ---
  if (opts.endpoint === "get" || opts.endpoint === "all") {
    const { successCount, firstFailAt } = await burstProbe(token, "get_meetings", { meeting_ids: [meetingId] }, {
      calls: opts.calls,
      gap: opts.gap,
      label: "get_meetings",
    });

    summary.push({
      endpoint: "get_meetings",
      burstLimit: firstFailAt !== null ? successCount : `>${opts.calls} (no limit detected)`,
      windowCleared: "n/a",
    });

    if (firstFailAt !== null && !opts.skipWindow) {
      const windowMs = await windowProbe(token, "get_meetings", { meeting_ids: [meetingId] }, {});
      summary[summary.length - 1].windowCleared = windowMs ? fmt(windowMs) : "unknown (>15m)";
    }
  }

  // --- get_meeting_transcript ---
  if (opts.endpoint === "transcript" || opts.endpoint === "all") {
    const { successCount, firstFailAt } = await burstProbe(token, "get_meeting_transcript", { meeting_id: meetingId }, {
      calls: opts.calls,
      gap: opts.gap,
      label: "get_meeting_transcript",
    });

    summary.push({
      endpoint: "get_meeting_transcript",
      burstLimit: firstFailAt !== null ? successCount : `>${opts.calls} (no limit detected)`,
      windowCleared: "n/a",
    });

    if (firstFailAt !== null && !opts.skipWindow) {
      const windowMs = await windowProbe(token, "get_meeting_transcript", { meeting_id: meetingId }, {});
      summary[summary.length - 1].windowCleared = windowMs ? fmt(windowMs) : "unknown (>15m)";
    }
  }

  // --- Summary ---
  console.log(`\n${"=".repeat(60)}`);
  console.log("  SUMMARY");
  console.log("=".repeat(60));
  console.log(`${"Endpoint".padEnd(30)} ${"Burst limit".padEnd(20)} Window`);
  console.log(`${"─".repeat(30)} ${"─".repeat(20)} ${"─".repeat(15)}`);
  for (const row of summary) {
    console.log(`${row.endpoint.padEnd(30)} ${String(row.burstLimit).padEnd(20)} ${row.windowCleared}`);
  }
  console.log();
  console.log("Update CLAUDE.md with these findings if they differ from current values.");
  console.log("Known values as of 2026-03-03:");
  console.log("  list_meetings:           no limit detected in normal use");
  console.log("  get_meetings:            no limit detected in normal use");
  console.log("  get_meeting_transcript:  ~2 calls per ~7 minute window");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

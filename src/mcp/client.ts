import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getAccessToken, AuthError, refreshAccessToken, discoverMetadata } from "../auth/oauth.js";
import { loadClientInfo, loadTokens } from "../auth/token-store.js";
import type {
  ListMeetingsParams,
  GetMeetingParams,
  GetTranscriptParams,
  QueryParams,
  Meeting,
  MeetingDetail,
  Attendee,
  TranscriptResult,
} from "./types.js";

const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

// Timeout defaults (ms)
const TIMEOUT_LIST = 30_000;
const TIMEOUT_GET = 30_000;
const TIMEOUT_TRANSCRIPT = 30_000;
const TIMEOUT_QUERY = 60_000;

interface ContentItem {
  type: string;
  text?: string;
}

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as ContentItem[])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
}

// ---------------------------------------------------------------------------
// XML parsing helpers
// ---------------------------------------------------------------------------

/**
 * Convert the API date string ("Mar 3, 2026 6:00 PM") to ISO 8601.
 * Falls back to the raw string if parsing fails rather than crashing.
 */
function parseApiDate(raw: string): string {
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();
  return raw;
}

/**
 * Extract a named attribute value from an XML opening-tag attribute string.
 * Handles both single- and double-quoted values.
 */
function extractAttr(attrs: string, name: string): string {
  const re = new RegExp(`${name}=["']([^"']*)["']`);
  const m = attrs.match(re);
  return m ? m[1] : "";
}

/**
 * Decode the XML entities that appear in Granola attribute values.
 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Parse the known_participants text block into Attendee[].
 *
 * Input format (whitespace-trimmed):
 *   "Andy Hahn (note creator) from Tackle <andy@example.com>, Bob Jones <bob@example.com>"
 *
 * Strategy: split on the "> ," boundary (end of one email, start of next entry),
 * re-attach the ">" to each fragment, then extract name + email per fragment.
 */
function parseAttendees(raw: string): Attendee[] {
  if (!raw.trim()) return [];

  const parts = raw
    .trim()
    .split(/>[\s]*,[\s]*/)
    .map((p, i, arr) => (i < arr.length - 1 ? p + ">" : p).trim())
    .filter(Boolean);

  return parts.map((part): Attendee => {
    // Capture: name (before optional annotation / "from Company"), then <email>
    const match = part.match(/^([\s\S]+?)\s*(?:\([^)]*\))?\s*(?:from\s+[^<]+?)?\s*<([^>]+)>$/);
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    // No email found — treat whole string as a name only
    return { name: part.trim() };
  });
}

/**
 * Parse the XML returned by list_meetings into Meeting[].
 *
 * Structure:
 *   <meetings_data from="..." to="..." count="N">
 *     <meeting id="UUID" title="..." date="Mar 3, 2026 6:00 PM">
 *       <known_participants>Name <email>, ...</known_participants>
 *     </meeting>
 *   </meetings_data>
 */
function parseXmlMeetings(xml: string): Meeting[] {
  const meetings: Meeting[] = [];
  const meetingRe = /<meeting\s([^>]*)>([\s\S]*?)<\/meeting>/g;
  let m: RegExpExecArray | null;

  while ((m = meetingRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body  = m[2];

    const id         = extractAttr(attrs, "id");
    const title      = decodeXmlEntities(extractAttr(attrs, "title"));
    const date       = extractAttr(attrs, "date");
    const pMatch     = body.match(/<known_participants>([\s\S]*?)<\/known_participants>/);
    const attendees  = pMatch ? parseAttendees(pMatch[1]) : [];

    meetings.push({
      id,
      title,
      start_time: date ? parseApiDate(date) : undefined,
      attendees,
    });
  }

  return meetings;
}

/**
 * Parse the XML returned by get_meetings into MeetingDetail[].
 * Extends the list parser by also extracting <summary>.
 */
function parseXmlMeetingDetail(xml: string): MeetingDetail[] {
  const details: MeetingDetail[] = [];
  const meetingRe = /<meeting\s([^>]*)>([\s\S]*?)<\/meeting>/g;
  let m: RegExpExecArray | null;

  while ((m = meetingRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body  = m[2];

    const id    = extractAttr(attrs, "id");
    const title = decodeXmlEntities(extractAttr(attrs, "title"));
    const date  = extractAttr(attrs, "date");

    const pMatch    = body.match(/<known_participants>([\s\S]*?)<\/known_participants>/);
    const attendees = pMatch ? parseAttendees(pMatch[1]) : [];

    const sMatch  = body.match(/<summary>([\s\S]*?)<\/summary>/);
    const rawSummary = sMatch ? sMatch[1].trim() : undefined;
    // Treat "No summary" placeholder as absent
    const summary = rawSummary && rawSummary !== "No summary" ? rawSummary : undefined;

    details.push({
      id,
      title,
      start_time: date ? parseApiDate(date) : undefined,
      attendees,
      summary,
      notes: summary,          // summary is the best available content
      enhanced_notes: summary, // same — avoids the "no notes" fall-through in writer
    });
  }

  return details;
}

export class McpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  /**
   * Ensure the MCP client is connected and initialized.
   */
  async connect(): Promise<Client> {
    if (this.client) return this.client;

    const token = await getAccessToken();

    this.transport = new StreamableHTTPClientTransport(
      new URL(GRANOLA_MCP_URL),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    this.client = new Client(
      { name: "spoon-cli", version: "0.2.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    return this.client;
  }

  /**
   * Reconnect with a fresh token (after 401 / token refresh).
   */
  async reconnect(): Promise<Client> {
    await this.close();
    this.client = null;
    this.transport = null;
    return this.connect();
  }

  /**
   * Parse tool result into a usable value.
   */
  private parseResult(result: unknown, toolName: string): unknown {
    const r = result as Record<string, unknown>;

    if (r["isError"]) {
      const errorText = extractTextContent(r["content"]);
      throw new McpToolError(toolName, errorText);
    }

    // Handle legacy CompatibilityCallToolResult (toolResult field)
    if ("toolResult" in r) {
      const tr = r["toolResult"];
      if (typeof tr === "string") return tr;
      try {
        return JSON.parse(JSON.stringify(tr));
      } catch {
        return tr;
      }
    }

    const combined = extractTextContent(r["content"]);

    try {
      return JSON.parse(combined);
    } catch {
      return combined;
    }
  }

  /**
   * Call an MCP tool with automatic 401 recovery.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = TIMEOUT_GET
  ): Promise<unknown> {
    const client = await this.connect();

    try {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: timeoutMs }
      );

      return this.parseResult(result, name);
    } catch (error) {
      // If it's a tool error we threw, rethrow directly
      if (error instanceof McpToolError) throw error;

      // Handle 401 — try to refresh and retry once
      if (isUnauthorizedError(error)) {
        const refreshed = await this.tryRefresh();
        if (refreshed) {
          await this.reconnect();
          const retryClient = await this.connect();
          const retryResult = await retryClient.callTool(
            { name, arguments: args },
            undefined,
            { timeout: timeoutMs }
          );
          return this.parseResult(retryResult, name);
        }
        throw new AuthError("Session expired. Run: spoon auth login");
      }
      throw error;
    }
  }

  /**
   * Try to refresh the access token.
   */
  private async tryRefresh(): Promise<boolean> {
    try {
      const tokens = loadTokens();
      const clientInfo = loadClientInfo();
      if (!tokens?.refresh_token || !clientInfo) return false;

      const metadata = await discoverMetadata();
      await refreshAccessToken(metadata, clientInfo.client_id, tokens.refresh_token);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close the MCP client connection.
   */
  async close(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
      }
    } catch {
      // Best effort
    }
    this.client = null;
    this.transport = null;
  }

  // --- High-level tool wrappers ---

  /**
   * List meetings.
   *
   * The server accepts a time_range enum (this_week | last_week | last_30_days | custom)
   * plus optional custom_start / custom_end ISO date strings. It does NOT accept
   * free-form since/until/limit — those are applied client-side after parsing.
   *
   * Default (no params): last_30_days.
   * When since is provided: custom range from since → until (or today).
   * The server's earliest data appears to be ~Dec 2025 regardless of custom_start.
   */
  async listMeetings(params: ListMeetingsParams = {}): Promise<Meeting[]> {
    const { folder, since, until, limit, attendee } = params;

    const args: Record<string, unknown> = {};
    if (attendee) args["attendee"] = attendee;

    if (since) {
      // Use custom range so the server returns meetings back to the requested date
      args["time_range"] = "custom";
      args["custom_start"] = since.slice(0, 10); // ISO date only: YYYY-MM-DD
      args["custom_end"] = until
        ? until.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    } else {
      // Default: server's own last_30_days window
      args["time_range"] = "last_30_days";
    }

    const raw = await this.callTool("list_meetings", args, TIMEOUT_LIST);
    const xmlStr = typeof raw === "string" ? raw : "";

    let meetings = parseXmlMeetings(xmlStr);

    // Sort descending by date (most recent first — consistent with web app)
    meetings.sort((a, b) => {
      const ta = a.start_time ? new Date(a.start_time).getTime() : 0;
      const tb = b.start_time ? new Date(b.start_time).getTime() : 0;
      return tb - ta;
    });

    if (limit !== undefined && limit > 0) {
      meetings = meetings.slice(0, limit);
    }

    // Folder filter — folder_membership is not present in XML so this will
    // always return empty results. Warn the user rather than silently returning nothing.
    if (folder) {
      const filtered = filterByFolder(meetings, folder);
      if (filtered.length === 0 && meetings.length > 0) {
        process.stderr.write(
          `Warning: --folder filter has no effect because the API does not return folder data in list results.\n`
        );
      }
      return filtered;
    }

    return meetings;
  }

  async getMeetings(params: GetMeetingParams): Promise<MeetingDetail[]> {
    const args: Record<string, unknown> = {
      meeting_ids: params.meeting_ids,
    };
    if (params.include_private_notes !== undefined) {
      args["include_private_notes"] = params.include_private_notes;
    }
    if (params.include_enhanced_notes !== undefined) {
      args["include_enhanced_notes"] = params.include_enhanced_notes;
    }

    const raw = await this.callTool("get_meetings", args, TIMEOUT_GET);
    const xmlStr = typeof raw === "string" ? raw : "";

    return parseXmlMeetingDetail(xmlStr);
  }

  async getTranscript(params: GetTranscriptParams): Promise<TranscriptResult | null> {
    const raw = await this.callTool(
      "get_meeting_transcript",
      { meeting_id: params.meeting_id },
      TIMEOUT_TRANSCRIPT,
    );

    // Server returns JSON for transcripts: {id, title, transcript: string}
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      if (typeof r["transcript"] === "string") {
        return {
          id:         String(r["id"] ?? params.meeting_id),
          title:      String(r["title"] ?? ""),
          transcript: r["transcript"] as string,
        };
      }
    }

    return null;
  }

  async query(params: QueryParams): Promise<unknown> {
    return this.callTool("query_granola_meetings", { query: params.query }, TIMEOUT_QUERY);
  }
}

// --- Client-side filters ---

/**
 * Filter meetings by folder name or folder ID (case-insensitive).
 * Note: folder_membership is not included in list_meetings XML responses —
 * this filter only works if folder data is present on the meeting objects.
 */
function filterByFolder(meetings: Meeting[], folder: string): Meeting[] {
  const normalized = folder.trim().toLowerCase();
  return meetings.filter((m) => {
    const memberships = m.folder_membership;
    if (!Array.isArray(memberships) || memberships.length === 0) return false;
    return memberships.some(
      (f) =>
        f.id.toLowerCase() === normalized ||
        f.name.toLowerCase() === normalized
    );
  });
}

// --- Error helpers ---

function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("unauthorized") || msg.includes("401")) return true;
  }
  // Check for StreamableHTTPError with code 401
  if (typeof error === "object" && error !== null && "code" in error) {
    return (error as { code: number }).code === 401;
  }
  return false;
}

export class McpToolError extends Error {
  constructor(
    public readonly toolName: string,
    message: string
  ) {
    super(`MCP tool "${toolName}" error: ${message}`);
    this.name = "McpToolError";
  }
}

// --- Singleton ---

let _instance: McpClient | null = null;

export function getMcpClient(): McpClient {
  if (!_instance) {
    _instance = new McpClient();
  }
  return _instance;
}

export async function closeMcpClient(): Promise<void> {
  if (_instance) {
    await _instance.close();
    _instance = null;
  }
}

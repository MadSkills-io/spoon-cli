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
      { name: "granola-cli", version: "0.1.0" },
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
        throw new AuthError("Session expired. Run: granola auth login");
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

  async listMeetings(params: ListMeetingsParams = {}): Promise<unknown> {
    // Strip folder — it's a client-side filter, not sent to the MCP server
    const { folder, ...serverParams } = params;

    const args: Record<string, unknown> = {};
    if (serverParams.since) args["since"] = serverParams.since;
    if (serverParams.until) args["until"] = serverParams.until;
    if (serverParams.attendee) args["attendee"] = serverParams.attendee;
    if (serverParams.limit !== undefined) args["limit"] = serverParams.limit;

    const result = await this.callTool("list_meetings", args, TIMEOUT_LIST);

    // Apply client-side folder filter if requested
    if (folder && Array.isArray(result)) {
      return filterByFolder(result as Meeting[], folder);
    }

    return result;
  }

  async getMeetings(params: GetMeetingParams): Promise<unknown> {
    const args: Record<string, unknown> = {
      meeting_ids: params.meeting_ids,
    };
    if (params.include_private_notes !== undefined) {
      args["include_private_notes"] = params.include_private_notes;
    }
    if (params.include_enhanced_notes !== undefined) {
      args["include_enhanced_notes"] = params.include_enhanced_notes;
    }

    return this.callTool("get_meetings", args, TIMEOUT_GET);
  }

  async getTranscript(params: GetTranscriptParams): Promise<unknown> {
    return this.callTool("get_meeting_transcript", { meeting_id: params.meeting_id }, TIMEOUT_TRANSCRIPT);
  }

  async query(params: QueryParams): Promise<unknown> {
    return this.callTool("query_granola_meetings", { query: params.query }, TIMEOUT_QUERY);
  }
}

// --- Client-side filters ---

/**
 * Filter meetings by folder name or folder ID (case-insensitive).
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

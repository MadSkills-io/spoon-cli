/**
 * Mock MCP server for integration testing.
 *
 * Simulates the Granola MCP server API for use in tests.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

export interface MockMeetingData {
  id: string;
  title: string;
  start_time: string;
  attendees: Array<{ name: string; email: string }>;
  summary?: string;
  folder_membership?: Array<{ id: string; name: string; object: "folder" }>;
}

export const MOCK_MEETINGS: MockMeetingData[] = [
  {
    id: "meeting-001",
    title: "Q1 Planning Session",
    start_time: "2024-01-15T09:00:00Z",
    attendees: [
      { name: "Alice Smith", email: "alice@example.com" },
      { name: "Bob Jones", email: "bob@example.com" },
    ],
    summary: "Discussed Q1 roadmap and priorities.",
    folder_membership: [
      { id: "fol_AbCdEfGhIjKlMn", name: "Planning", object: "folder" as const },
    ],
  },
  {
    id: "meeting-002",
    title: "Standup",
    start_time: "2024-01-16T09:00:00Z",
    attendees: [{ name: "Alice Smith", email: "alice@example.com" }],
    summary: "Daily standup updates.",
  },
];

// ---------------------------------------------------------------------------
// XML rendering helpers — match the real Granola MCP server response format
// ---------------------------------------------------------------------------

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;");
}

function formatMockDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function renderMockMeetingListXml(meetings: MockMeetingData[]): string {
  const tags = meetings.map((m) => {
    const participants = m.attendees.map((a) => `${a.name} <${a.email}>`).join(", ");
    return [
      `  <meeting id="${escapeXmlAttr(m.id)}" title="${escapeXmlAttr(m.title)}" date="${formatMockDate(m.start_time)}">`,
      `    <known_participants>`,
      `    ${participants}`,
      `    </known_participants>`,
      `  </meeting>`,
    ].join("\n");
  });
  return [`<meetings_data count="${meetings.length}">`, ...tags, `</meetings_data>`].join("\n");
}

function renderMockMeetingDetailXml(meetings: MockMeetingData[]): string {
  const tags = meetings.map((m) => {
    const participants = m.attendees.map((a) => `${a.name} <${a.email}>`).join(", ");
    const summary = m.summary ?? "";
    return [
      `  <meeting id="${escapeXmlAttr(m.id)}" title="${escapeXmlAttr(m.title)}" date="${formatMockDate(m.start_time)}">`,
      `    <known_participants>`,
      `    ${participants}`,
      `    </known_participants>`,
      `    <summary>`,
      `${summary}`,
      `    </summary>`,
      `  </meeting>`,
    ].join("\n");
  });
  return [`<meetings_data count="${meetings.length}">`, ...tags, `</meetings_data>`].join("\n");
}

// ---------------------------------------------------------------------------

function handleJsonRpc(
  body: Record<string, unknown>
): unknown {
  const method = body["method"] as string;
  const id = body["id"];

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock-granola-server", version: "1.0.0" },
      },
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          { name: "list_meetings", description: "List meetings", inputSchema: { type: "object", properties: {} } },
          { name: "get_meetings", description: "Get meeting details", inputSchema: { type: "object", properties: { meeting_ids: { type: "array" } } } },
          { name: "get_meeting_transcript", description: "Get transcript", inputSchema: { type: "object", properties: { meeting_id: { type: "string" } } } },
          { name: "query_granola_meetings", description: "Query meetings", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
        ],
      },
    };
  }

  if (method === "tools/call") {
    const params = body["params"] as Record<string, unknown>;
    const toolName = params["name"] as string;
    const args = (params["arguments"] ?? {}) as Record<string, unknown>;

    if (toolName === "list_meetings") {
      let meetings = MOCK_MEETINGS;
      if (args["attendee"]) {
        const attendeeFilter = String(args["attendee"]).toLowerCase();
        meetings = meetings.filter((m) =>
          m.attendees.some(
            (a) =>
              a.name.toLowerCase().includes(attendeeFilter) ||
              a.email.toLowerCase().includes(attendeeFilter)
          )
        );
      }

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: renderMockMeetingListXml(meetings) }],
          isError: false,
        },
      };
    }

    if (toolName === "get_meetings") {
      const meetingIds = args["meeting_ids"] as string[];
      const meetings = MOCK_MEETINGS.filter((m) => meetingIds.includes(m.id));

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: renderMockMeetingDetailXml(meetings) }],
          isError: false,
        },
      };
    }

    if (toolName === "get_meeting_transcript") {
      const meetingId = args["meeting_id"] as string;
      const meeting = MOCK_MEETINGS.find((m) => m.id === meetingId);

      if (!meeting) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Meeting ${meetingId} not found` }],
            isError: true,
          },
        };
      }

      // Return flat JSON matching the real server shape: {id, title, transcript}
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id:         meeting.id,
                title:      meeting.title,
                transcript: "Alice Smith: Let's get started.\nBob Jones: Sounds good.",
              }),
            },
          ],
          isError: false,
        },
      };
    }

    if (toolName === "query_granola_meetings") {
      const query = args["query"] as string;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                answer: `Based on your meetings, the answer to "${query}" is: This is a mock response.`,
                sources: MOCK_MEETINGS.slice(0, 1),
              }),
            },
          ],
          isError: false,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${toolName}` },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown method: ${method}` },
  };
}

export interface MockServer {
  url: string;
  close: () => Promise<void>;
}

export async function startMockMcpServer(): Promise<MockServer> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const response = handleJsonRpc(parsed);

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "mock-session-123",
        });
        res.end(JSON.stringify(response));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

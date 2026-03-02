/**
 * Granola MCP server tool response types.
 *
 * These map to the tools exposed by https://mcp.granola.ai/mcp
 */

// --- list_meetings ---

export interface Meeting {
  id: string;
  title: string;
  start_time?: string;
  end_time?: string;
  attendees?: Attendee[];
  summary?: string;
  url?: string;
  [key: string]: unknown;
}

export interface Attendee {
  name?: string;
  email?: string;
  [key: string]: unknown;
}

export interface ListMeetingsParams {
  since?: string;
  until?: string;
  attendee?: string;
  limit?: number;
}

// --- get_meetings ---

export interface MeetingDetail extends Meeting {
  notes?: string;
  enhanced_notes?: string;
  private_notes?: string;
  panels?: MeetingPanel[];
  [key: string]: unknown;
}

export interface MeetingPanel {
  id: string;
  type: string;
  content: string;
  [key: string]: unknown;
}

export interface GetMeetingParams {
  meeting_ids: string[];
  include_private_notes?: boolean;
  include_enhanced_notes?: boolean;
}

// --- get_meeting_transcript ---

export interface TranscriptSegment {
  speaker?: string;
  text: string;
  start_time?: string;
  end_time?: string;
  [key: string]: unknown;
}

export interface GetTranscriptParams {
  meeting_id: string;
}

// --- query_granola_meetings ---

export interface QueryParams {
  query: string;
}

export interface QueryResult {
  answer: string;
  sources?: Meeting[];
  [key: string]: unknown;
}

// --- MCP tool call result content ---

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallResult {
  content: TextContent[];
  isError?: boolean;
}

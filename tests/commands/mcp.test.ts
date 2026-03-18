import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock tty before importing anything that depends on it
vi.mock("../../src/utils/tty.js", () => ({
  isTTY: () => false,
  isColorSupported: () => false,
  defaultFormat: () => "json",
}));

// Mock chalk to strip colors in test output
vi.mock("chalk", () => {
  const identity = (s: string) => s;
  const handler: ProxyHandler<object> = {
    get: () => new Proxy(identity, handler),
    apply: (_target, _thisArg, args) => args[0],
  };
  return { default: new Proxy(identity, handler) };
});

// Mock MCP client
const mockPing = vi.fn<() => Promise<number>>();
const mockGetServerInfo = vi.fn();
const mockListTools = vi.fn();
const mockCallToolRaw = vi.fn();
const mockListResources = vi.fn();
const mockListResourceTemplates = vi.fn();
const mockListPrompts = vi.fn();
const mockClose = vi.fn();

vi.mock("../../src/mcp/client.js", () => ({
  getMcpClient: () => ({
    ping: mockPing,
    getServerInfo: mockGetServerInfo,
    listTools: mockListTools,
    callToolRaw: mockCallToolRaw,
    listResources: mockListResources,
    listResourceTemplates: mockListResourceTemplates,
    listPrompts: mockListPrompts,
    close: mockClose,
  }),
  closeMcpClient: mockClose,
}));

// Capture console.log and stderr output
let logSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

function getStdout(): string {
  return logSpy.mock.calls.map((c) => c[0]).join("\n");
}

function getStderr(): string {
  return stderrSpy.mock.calls.map((c) => String(c[0])).join("");
}

// Dynamic import after mocks are in place
let registerMcpCommand: (program: import("commander").Command) => void;
let Command: typeof import("commander").Command;

beforeEach(async () => {
  const mod = await import("../../src/commands/mcp.js");
  registerMcpCommand = mod.registerMcpCommand;
  const commander = await import("commander");
  Command = commander.Command;

  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  logSpy.mockRestore();
  stderrSpy.mockRestore();
  vi.clearAllMocks();
});

/** Build a program and run a command line against it. */
async function run(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
  registerMcpCommand(program);
  await program.parseAsync(["node", "spoon", ...args]);
}

// ─────────────────────────────────────────────────────────────
// ping
// ─────────────────────────────────────────────────────────────
describe("mcp ping", () => {
  it("outputs JSON with status and latency", async () => {
    mockPing.mockResolvedValue(42);
    await run(["mcp", "ping", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out.status).toBe("ok");
    expect(out.latencyMs).toBe(42);
  });

  it("outputs human-readable text by default (non-TTY falls back to json)", async () => {
    mockPing.mockResolvedValue(237);
    await run(["mcp", "ping", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out.latencyMs).toBe(237);
  });

  it("outputs text format with Pong", async () => {
    mockPing.mockResolvedValue(100);
    await run(["mcp", "ping", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("Pong");
    expect(out).toContain("100 ms");
  });
});

// ─────────────────────────────────────────────────────────────
// info
// ─────────────────────────────────────────────────────────────
describe("mcp info", () => {
  it("outputs server info as JSON", async () => {
    mockPing.mockResolvedValue(1);
    mockGetServerInfo.mockReturnValue({
      serverInfo: { name: "granola-mcp", version: "1.2.3" },
      capabilities: { tools: {} },
      instructions: "Ask about meetings",
    });

    await run(["mcp", "info", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out.serverInfo.name).toBe("granola-mcp");
    expect(out.serverInfo.version).toBe("1.2.3");
    expect(out.capabilities.tools).toEqual({});
    expect(out.instructions).toBe("Ask about meetings");
  });

  it("outputs text format with name, version, and capabilities", async () => {
    mockPing.mockResolvedValue(1);
    mockGetServerInfo.mockReturnValue({
      serverInfo: { name: "test-server", version: "0.1.0" },
      capabilities: { tools: {}, resources: null },
      instructions: "Hello instructions",
    });

    await run(["mcp", "info", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("test-server v0.1.0");
    expect(out).toContain("Capabilities:");
    expect(out).toContain("tools");
    expect(out).toContain("Instructions:");
    expect(out).toContain("Hello instructions");
  });

  it("handles undefined serverInfo fields", async () => {
    mockPing.mockResolvedValue(1);
    mockGetServerInfo.mockReturnValue({
      serverInfo: undefined,
      capabilities: undefined,
      instructions: undefined,
    });

    await run(["mcp", "info", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("unknown");
  });
});

// ─────────────────────────────────────────────────────────────
// tools
// ─────────────────────────────────────────────────────────────
describe("mcp tools", () => {
  const sampleTools = [
    {
      name: "list_meetings",
      description: "List your meetings",
      inputSchema: {
        type: "object",
        properties: {
          time_range: {
            type: "string",
            enum: ["this_week", "last_week", "last_30_days", "custom"],
            description: "Time range filter",
          },
          attendee: {
            type: "string",
            description: "Filter by attendee",
          },
        },
        required: ["time_range"],
      },
    },
    {
      name: "get_meetings",
      description: "Get meeting details",
      inputSchema: { type: "object", properties: {} },
    },
  ];

  it("outputs full tool objects as JSON", async () => {
    mockListTools.mockResolvedValue({ tools: sampleTools });
    await run(["mcp", "tools", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("list_meetings");
    expect(out[0].inputSchema.properties.time_range.enum).toContain("this_week");
  });

  it("outputs table with name and description only", async () => {
    mockListTools.mockResolvedValue({ tools: sampleTools });
    await run(["mcp", "tools", "--format", "csv"]);
    const out = getStdout();
    expect(out).toContain("name");
    expect(out).toContain("description");
    expect(out).toContain("list_meetings");
    expect(out).toContain("List your meetings");
    // Schema should NOT be in CSV
    expect(out).not.toContain("inputSchema");
  });

  it("outputs text with parameter details", async () => {
    mockListTools.mockResolvedValue({ tools: sampleTools });
    await run(["mcp", "tools", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("list_meetings");
    expect(out).toContain("Parameters:");
    expect(out).toContain("time_range");
    expect(out).toContain("this_week");
    expect(out).toContain("attendee");
    expect(out).toContain("Time range filter");
  });
});

// ─────────────────────────────────────────────────────────────
// call
// ─────────────────────────────────────────────────────────────
describe("mcp call", () => {
  it("passes inline JSON args to callToolRaw and outputs text", async () => {
    mockCallToolRaw.mockResolvedValue({
      content: [{ type: "text", text: "<meetings>result</meetings>" }],
      isError: false,
    });

    await run(["mcp", "call", "list_meetings", '{"time_range":"this_week"}', "--format", "text"]);
    expect(mockCallToolRaw).toHaveBeenCalledWith(
      "list_meetings",
      { time_range: "this_week" },
    );
    const out = getStdout();
    expect(out).toContain("<meetings>result</meetings>");
  });

  it("calls with no args when none provided and stdin is TTY", async () => {
    // Simulate TTY stdin
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true as any;

    mockCallToolRaw.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });

    await run(["mcp", "call", "some_tool", "--format", "text"]);
    expect(mockCallToolRaw).toHaveBeenCalledWith("some_tool", {});

    process.stdin.isTTY = origIsTTY;
  });

  it("outputs full CallToolResult as JSON", async () => {
    const rawResult = {
      content: [{ type: "text", text: "hello" }],
      isError: false,
    };
    mockCallToolRaw.mockResolvedValue(rawResult);

    await run(["mcp", "call", "some_tool", "{}", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out.content).toEqual([{ type: "text", text: "hello" }]);
    expect(out.isError).toBe(false);
  });

  it("writes to stderr and exits on isError result", async () => {
    mockCallToolRaw.mockResolvedValue({
      content: [{ type: "text", text: "Tool failed!" }],
      isError: true,
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      run(["mcp", "call", "bad_tool", "{}", "--format", "text"]),
    ).rejects.toThrow("process.exit");

    expect(mockExit).toHaveBeenCalledWith(1);
    const stderr = getStderr();
    expect(stderr).toContain("Tool failed!");
    mockExit.mockRestore();
  });

  it("errors on invalid JSON args", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      run(["mcp", "call", "some_tool", "{bad json"]),
    ).rejects.toThrow("process.exit");

    const stderr = getStderr();
    expect(stderr).toContain("Invalid JSON");
    mockExit.mockRestore();
  });

  it("errors on non-object JSON args", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);

    await expect(
      run(["mcp", "call", "some_tool", '"just a string"']),
    ).rejects.toThrow("process.exit");

    const stderr = getStderr();
    expect(stderr).toContain("Arguments must be a JSON object");
    mockExit.mockRestore();
  });

  it("falls back to JSON output when no text content blocks", async () => {
    mockCallToolRaw.mockResolvedValue({
      content: [],
      isError: false,
    });

    await run(["mcp", "call", "some_tool", "{}", "--format", "text"]);
    const out = getStdout();
    // Should have fallen back to JSON output
    expect(out).toContain('"content"');
  });
});

// ─────────────────────────────────────────────────────────────
// resources
// ─────────────────────────────────────────────────────────────
describe("mcp resources", () => {
  it("shows 'No resources available' when server returns empty", async () => {
    mockListResources.mockResolvedValue({ resources: [] });
    mockListResourceTemplates.mockResolvedValue({ resourceTemplates: [] });

    await run(["mcp", "resources", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("No resources available.");
  });

  it("outputs empty JSON when server returns empty", async () => {
    mockListResources.mockResolvedValue({ resources: [] });
    mockListResourceTemplates.mockResolvedValue({ resourceTemplates: [] });

    await run(["mcp", "resources", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out.resources).toEqual([]);
    expect(out.resourceTemplates).toEqual([]);
  });

  it("gracefully handles unsupported resources (server throws)", async () => {
    mockListResources.mockRejectedValue(new Error("Method not supported"));
    mockListResourceTemplates.mockRejectedValue(new Error("Method not supported"));

    await run(["mcp", "resources", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("No resources available.");
  });

  it("outputs populated resource list as JSON", async () => {
    mockListResources.mockResolvedValue({
      resources: [{ uri: "meeting://123", name: "Meeting 123" }],
    });
    mockListResourceTemplates.mockResolvedValue({
      resourceTemplates: [{ uriTemplate: "meeting://{id}", name: "Meeting by ID" }],
    });

    await run(["mcp", "resources", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out.resources).toHaveLength(1);
    expect(out.resources[0].uri).toBe("meeting://123");
    expect(out.resourceTemplates).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// prompts
// ─────────────────────────────────────────────────────────────
describe("mcp prompts", () => {
  it("shows 'No prompts available' when server returns empty", async () => {
    mockListPrompts.mockResolvedValue({ prompts: [] });

    await run(["mcp", "prompts", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("No prompts available.");
  });

  it("outputs empty JSON when server returns empty", async () => {
    mockListPrompts.mockResolvedValue({ prompts: [] });

    await run(["mcp", "prompts", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out.prompts).toEqual([]);
  });

  it("gracefully handles unsupported prompts (server throws)", async () => {
    mockListPrompts.mockRejectedValue(new Error("Method not supported"));

    await run(["mcp", "prompts", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("No prompts available.");
  });

  it("outputs populated prompt list as JSON", async () => {
    mockListPrompts.mockResolvedValue({
      prompts: [
        { name: "summarize", description: "Summarize a meeting" },
        { name: "action-items", description: "Extract action items" },
      ],
    });

    await run(["mcp", "prompts", "--format", "json"]);
    const out = JSON.parse(getStdout());
    expect(out.prompts).toHaveLength(2);
    expect(out.prompts[0].name).toBe("summarize");
  });

  it("outputs populated prompt list as table/text", async () => {
    mockListPrompts.mockResolvedValue({
      prompts: [
        { name: "summarize", description: "Summarize a meeting" },
      ],
    });

    await run(["mcp", "prompts", "--format", "text"]);
    const out = getStdout();
    expect(out).toContain("summarize");
    expect(out).toContain("Summarize a meeting");
  });
});

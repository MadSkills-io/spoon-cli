import { Command } from "commander";
import chalk from "chalk";
import { getMcpClient, closeMcpClient } from "../mcp/client.js";
import { output, resolveFormat } from "../output/formatter.js";
import { handleError, writeError, EXIT_ERROR } from "../output/errors.js";
import { isTTY } from "../utils/tty.js";

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("Inspect and interact with the MCP server directly");

  // --- ping ---
  mcp
    .command("ping")
    .description("Health check — measure round-trip latency to the MCP server")
    .option("--format <format>", "Output format: json, text")
    .addHelpText("after", `
Examples:
  $ spoon mcp ping
  $ spoon mcp ping --format json`)
    .action(async (options: { format?: string }) => {
      try {
        const client = getMcpClient();
        const latencyMs = await client.ping();
        const format = resolveFormat(options.format);

        if (format === "json") {
          output({ status: "ok", latencyMs }, "json");
        } else {
          console.log(`${chalk.green("Pong")} ${chalk.dim(`(${latencyMs} ms)`)}`);
        }

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });

  // --- info ---
  mcp
    .command("info")
    .description("Show MCP server version, capabilities, and instructions")
    .option("--format <format>", "Output format: json, table, text, markdown")
    .addHelpText("after", `
Examples:
  $ spoon mcp info
  $ spoon mcp info --format json`)
    .action(async (options: { format?: string }) => {
      try {
        const client = getMcpClient();
        await client.ping(); // ensure connected
        const info = client.getServerInfo();
        const format = resolveFormat(options.format);

        if (format === "json" || format === "csv") {
          output(info, "json");
        } else if (format === "text" || format === "table" || format === "markdown") {
          const name = info.serverInfo?.name ?? "unknown";
          const version = info.serverInfo?.version ?? "unknown";
          console.log(chalk.bold(`${name} v${version}`));

          if (info.capabilities && Object.keys(info.capabilities).length > 0) {
            console.log("");
            console.log(chalk.bold("Capabilities:"));
            for (const [key, value] of Object.entries(info.capabilities)) {
              const mark = value ? chalk.green("✓") : chalk.dim("✗");
              console.log(`  ${mark} ${key}`);
            }
          }

          if (info.instructions) {
            console.log("");
            console.log(chalk.bold("Instructions:"));
            console.log(`  ${info.instructions}`);
          }
        }

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });

  // --- tools ---
  mcp
    .command("tools")
    .description("List all tools the server exposes with descriptions and input schemas")
    .option("--format <format>", "Output format: json, table, text, markdown, csv")
    .addHelpText("after", `
Examples:
  $ spoon mcp tools
  $ spoon mcp tools --format json
  $ spoon mcp tools --format table`)
    .action(async (options: { format?: string }) => {
      try {
        const client = getMcpClient();
        const result = await client.listTools();
        const tools = result.tools as Array<{
          name?: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
        const format = resolveFormat(options.format);

        if (format === "json" || format === "markdown") {
          output(tools, format);
        } else if (format === "csv" || format === "table") {
          // Table/CSV: name + description (schemas are too wide)
          const rows = tools.map((t) => ({
            name: t.name ?? "",
            description: t.description ?? "",
          }));
          output(rows, format);
        } else {
          // Text: detailed output with parameter info
          for (const tool of tools) {
            console.log(chalk.bold(tool.name ?? "(unnamed)"));
            if (tool.description) {
              console.log(`  ${tool.description}`);
            }
            if (tool.inputSchema) {
              const schema = tool.inputSchema;
              const props = schema["properties"] as Record<string, Record<string, unknown>> | undefined;
              const required = (schema["required"] as string[]) ?? [];

              if (props && Object.keys(props).length > 0) {
                console.log("");
                console.log(`  ${chalk.cyan("Parameters:")}`);
                for (const [name, prop] of Object.entries(props)) {
                  const type = prop["type"] ?? "any";
                  const reqMark = required.includes(name) ? chalk.red("*") : "";
                  const enumValues = prop["enum"] as string[] | undefined;
                  const desc = prop["description"] as string | undefined;

                  let line = `    ${chalk.yellow(name)}${reqMark} ${chalk.dim(`(${type})`)}`;
                  if (enumValues) {
                    line += ` ${chalk.dim("[")}${enumValues.join(chalk.dim(" | "))}${chalk.dim("]")}`;
                  }
                  console.log(line);
                  if (desc) {
                    console.log(`      ${chalk.dim(desc)}`);
                  }
                }
              }
            }
            console.log("");
          }
        }

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });

  // --- call ---
  mcp
    .command("call <tool-name> [args-json]")
    .description("Call any MCP tool by name with optional JSON arguments")
    .option("--format <format>", "Output format: json, text")
    .addHelpText("after", `
Examples:
  $ spoon mcp call list_meetings '{"time_range":"this_week"}'
  $ spoon mcp call list_meetings '{"time_range":"this_week"}' --format json
  $ echo '{"time_range":"this_week"}' | spoon mcp call list_meetings
  $ spoon mcp call get_meeting_transcript '{"meeting_id":"abc123"}'`)
    .action(async (toolName: string, argsJson: string | undefined, options: { format?: string }) => {
      try {
        let args: Record<string, unknown> = {};

        if (argsJson) {
          // Inline JSON argument
          args = parseJsonArgs(argsJson);
        } else if (!process.stdin.isTTY) {
          // Read from stdin (piped input)
          const stdinData = await readStdin();
          if (stdinData.trim()) {
            args = parseJsonArgs(stdinData.trim());
          }
        }
        // If both are absent and stdin is a TTY → no args (empty object)

        const client = getMcpClient();
        const result = await client.callToolRaw(toolName, args);
        const format = resolveFormat(options.format);

        const r = result as Record<string, unknown>;

        // If the tool returned an error, write to stderr and exit 1
        if (r["isError"]) {
          const errorText = extractTextFromContent(r["content"]);
          writeError(errorText || "Tool returned an error", EXIT_ERROR);
          await closeMcpClient();
          process.exit(EXIT_ERROR);
        }

        if (format === "json") {
          output(result, "json");
        } else {
          // Text: concatenate text content blocks
          const text = extractTextFromContent(r["content"]);
          if (text) {
            console.log(text);
          } else {
            // Fallback: show raw JSON
            output(result, "json");
          }
        }

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });

  // --- resources ---
  mcp
    .command("resources")
    .description("List resources the server exposes")
    .option("--format <format>", "Output format: json, table, text, markdown, csv")
    .addHelpText("after", `
Examples:
  $ spoon mcp resources
  $ spoon mcp resources --format json`)
    .action(async (options: { format?: string }) => {
      try {
        const client = getMcpClient();
        const format = resolveFormat(options.format);

        let resources: unknown[] = [];
        let templates: unknown[] = [];

        try {
          const resResult = await client.listResources();
          resources = resResult.resources ?? [];
        } catch {
          // Server may not support resources — gracefully degrade
        }

        try {
          const tmplResult = await client.listResourceTemplates();
          templates = tmplResult.resourceTemplates ?? [];
        } catch {
          // Server may not support resource templates
        }

        if (resources.length === 0 && templates.length === 0) {
          if (format === "json") {
            output({ resources: [], resourceTemplates: [] }, "json");
          } else {
            console.log(chalk.dim("No resources available."));
          }
        } else {
          if (format === "json") {
            output({ resources, resourceTemplates: templates }, "json");
          } else {
            if (resources.length > 0) {
              console.log(chalk.bold("Resources:"));
              output(resources, format);
            }
            if (templates.length > 0) {
              console.log(chalk.bold("Resource Templates:"));
              output(templates, format);
            }
          }
        }

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });

  // --- prompts ---
  mcp
    .command("prompts")
    .description("List prompts the server exposes")
    .option("--format <format>", "Output format: json, table, text, markdown, csv")
    .addHelpText("after", `
Examples:
  $ spoon mcp prompts
  $ spoon mcp prompts --format json`)
    .action(async (options: { format?: string }) => {
      try {
        const client = getMcpClient();
        const format = resolveFormat(options.format);

        let prompts: unknown[] = [];

        try {
          const result = await client.listPrompts();
          prompts = result.prompts ?? [];
        } catch {
          // Server may not support prompts — gracefully degrade
        }

        if (prompts.length === 0) {
          if (format === "json") {
            output({ prompts: [] }, "json");
          } else {
            console.log(chalk.dim("No prompts available."));
          }
        } else if (format === "json" || format === "markdown") {
          output({ prompts }, format);
        } else if (format === "csv" || format === "table") {
          const rows = (prompts as Array<{ name?: string; description?: string }>).map((p) => ({
            name: p.name ?? "",
            description: p.description ?? "",
          }));
          output(rows, format);
        } else {
          // Text: name + description per prompt
          for (const p of prompts as Array<{ name?: string; description?: string; arguments?: unknown[] }>) {
            console.log(chalk.bold(p.name ?? "(unnamed)"));
            if (p.description) {
              console.log(`  ${p.description}`);
            }
            console.log("");
          }
        }

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });
}

// --- Helpers ---

/**
 * Parse a JSON string into an object, with a user-friendly error message.
 */
function parseJsonArgs(jsonStr: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    writeError(`Invalid JSON: ${jsonStr}`, EXIT_ERROR);
    process.exit(EXIT_ERROR);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    writeError("Arguments must be a JSON object (e.g. '{\"key\": \"value\"}')", EXIT_ERROR);
    process.exit(EXIT_ERROR);
  }

  return parsed as Record<string, unknown>;
}

/**
 * Extract concatenated text from CallToolResult content blocks.
 */
function extractTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type?: string; text?: string }>)
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
}

/**
 * Read all data from stdin (non-blocking for piped input).
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

import { Command } from "commander";
import chalk from "chalk";
import { registerAuthCommand } from "./commands/auth.js";
import { registerMeetingsCommand } from "./commands/meetings.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerSyncCommand } from "./commands/sync.js";
import { loadConfig, getConfigPath } from "./utils/config.js";
import { getGranolaDir } from "./auth/token-store.js";
import { output, resolveFormat } from "./output/formatter.js";
import { handleError } from "./output/errors.js";
import { closeMcpClient } from "./mcp/client.js";

const program = new Command();

program
  .name("granola")
  .description("CLI for querying Granola AI meeting notes via Granola's MCP server")
  .version("0.1.0")
  .addHelpText("after", `
Environment Variables:
  GRANOLA_TOKEN    Bearer token for authentication (skips OAuth flow)
  NO_COLOR         Disable colored output

Output Behavior:
  • TTY (interactive):  Human-readable tables/text with colors
  • Piped (non-TTY):   JSON for machine consumption
  • --format flag:      Always overrides auto-detection

Exit Codes:
  0  Success
  1  General error
  2  Authentication error
  3  Rate limited
  4  Not found

Examples:
  $ granola auth login
  $ granola meetings list --since "last week"
  $ granola meetings list --format json | jq '.[0].id'
  $ granola meetings get <id> --format markdown
  $ granola query "What were the action items from standup?"
  $ granola sync ./meetings --since "last week"
  $ GRANOLA_TOKEN=... granola meetings list`);

// Register subcommands
registerAuthCommand(program);
registerMeetingsCommand(program);
registerQueryCommand(program);
registerSyncCommand(program);

// --- config command ---
program
  .command("config")
  .description("Show current configuration")
  .option("--format <format>", "Output format: json, table, text")
  .addHelpText("after", `
Examples:
  $ granola config
  $ granola config --format json`)
  .action(async (options: { format?: string }) => {
    try {
      const config = loadConfig();
      const format = resolveFormat(options.format);

      const displayConfig = {
        ...config,
        configPath: getConfigPath(),
        credentialsDir: getGranolaDir(),
        envTokenSet: !!process.env["GRANOLA_TOKEN"],
      };

      output(displayConfig, format);
    } catch (error) {
      handleError(error);
    }
  });

// Handle unrecognized commands
program.on("command:*", () => {
  console.error(chalk.red(`Unknown command: ${program.args.join(" ")}`));
  console.error(`Run ${chalk.cyan("granola --help")} to see available commands.`);
  process.exit(1);
});

// Cleanup on exit
process.on("beforeExit", async () => {
  await closeMcpClient();
});

// Parse and execute
program.parseAsync(process.argv).catch(handleError);

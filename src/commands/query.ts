import { Command } from "commander";
import { getMcpClient, closeMcpClient } from "../mcp/client.js";
import { output, resolveQueryFormat } from "../output/formatter.js";
import { handleError } from "../output/errors.js";

export function registerQueryCommand(program: Command): void {
  program
    .command("query <question>")
    .description("Ask a natural language question across all your meetings")
    .option("--format <format>", "Output format: json, table, text")
    .addHelpText("after", `
Examples:
  $ spoon query "What action items came out of this week's standups?"
  $ spoon query "What did Sarah say about the Q4 roadmap?"
  $ spoon query "Summarize all meetings from last week" --format json
  $ spoon query "Who mentioned the budget?" --format text`)
    .action(async (question: string, options: { format?: string }) => {
      try {
        const client = getMcpClient();

        const result = await client.query({ query: question });
        const format = resolveQueryFormat(options.format);
        output(result, format);

        await closeMcpClient();
      } catch (error) {
        handleError(error);
      }
    });
}

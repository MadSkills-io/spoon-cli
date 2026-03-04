import { Command } from "commander";
import chalk from "chalk";
import { login, logout, getAuthStatus } from "../auth/oauth.js";
import { handleError } from "../output/errors.js";
import { output, resolveFormat } from "../output/formatter.js";
import { isTTY } from "../utils/tty.js";

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage authentication with Granola");

  auth
    .command("login")
    .description("Authenticate with Granola via browser OAuth flow")
    .addHelpText("after", `
Examples:
  $ spoon auth login          # Opens browser for OAuth
  $ GRANOLA_TOKEN=... granola   # Skip OAuth, use env var token`)
    .action(async () => {
      try {
        // Check if already authenticated via env var
        if (process.env["GRANOLA_TOKEN"]) {
          console.log(chalk.yellow("GRANOLA_TOKEN is set — already authenticated via environment variable."));
          return;
        }

        const tokens = await login();

        if (isTTY()) {
          console.log(chalk.green("✓ Authentication successful!"));
          if (tokens.expires_in) {
            const hours = Math.round(tokens.expires_in / 3600);
            console.log(chalk.dim(`  Token expires in ~${hours} hours.`));
          }
          console.log(chalk.dim("  Run `spoon auth status` to verify."));
        } else {
          console.log(JSON.stringify({ success: true }));
        }
      } catch (error) {
        handleError(error);
      }
    });

  auth
    .command("logout")
    .description("Revoke credentials and clear stored tokens")
    .addHelpText("after", `
Examples:
  $ spoon auth logout`)
    .action(async () => {
      try {
        await logout();

        if (isTTY()) {
          console.log(chalk.green("✓ Logged out successfully."));
        } else {
          console.log(JSON.stringify({ success: true }));
        }
      } catch (error) {
        handleError(error);
      }
    });

  auth
    .command("status")
    .description("Show current authentication state")
    .option("--format <format>", "Output format (json, table, text)")
    .addHelpText("after", `
Examples:
  $ spoon auth status
  $ spoon auth status --format json`)
    .action(async (options: { format?: string }) => {
      try {
        const status = getAuthStatus();
        const format = resolveFormat(options.format);

        if (format === "json") {
          output(status, "json");
        } else {
          if (status.authenticated) {
            console.log(chalk.green("✓ Authenticated"));
            if (status.hasEnvToken) {
              console.log(`  ${chalk.cyan("Source:")} GRANOLA_TOKEN environment variable`);
            }
            if (status.accessToken) {
              console.log(`  ${chalk.cyan("Token:")} ${status.accessToken}`);
            }
            if (status.expiresAt) {
              const d = new Date(status.expiresAt);
              const isExpired = d.getTime() < Date.now();
              console.log(`  ${chalk.cyan("Expires:")} ${d.toLocaleString()} ${isExpired ? chalk.red("(expired)") : ""}`);
            }
            if (status.hasRefreshToken) {
              console.log(`  ${chalk.cyan("Refresh:")} available`);
            }
            if (status.clientId) {
              console.log(`  ${chalk.cyan("Client:")} ${status.clientId}`);
            }
          } else {
            console.log(chalk.yellow("✗ Not authenticated"));
            console.log(chalk.dim("  Run: spoon auth login"));
          }
        }
      } catch (error) {
        handleError(error);
      }
    });
}

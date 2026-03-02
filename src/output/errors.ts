import chalk from "chalk";
import { isTTY } from "../utils/tty.js";

// Exit codes
export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_AUTH_ERROR = 2;
export const EXIT_RATE_LIMITED = 3;
export const EXIT_NOT_FOUND = 4;

export interface StructuredError {
  error: string;
  code: number;
  message: string;
  details?: string;
}

/**
 * Write an error to stderr and exit.
 */
export function exitWithError(
  message: string,
  exitCode: number = EXIT_ERROR,
  details?: string
): never {
  writeError(message, exitCode, details);
  process.exit(exitCode);
}

/**
 * Write an error to stderr (without exiting).
 */
export function writeError(
  message: string,
  exitCode: number = EXIT_ERROR,
  details?: string
): void {
  if (isTTY()) {
    // Human-readable colored output
    const prefix = exitCode === EXIT_AUTH_ERROR
      ? chalk.yellow("⚠ Auth Error:")
      : exitCode === EXIT_RATE_LIMITED
        ? chalk.yellow("⏳ Rate Limited:")
        : exitCode === EXIT_NOT_FOUND
          ? chalk.yellow("🔍 Not Found:")
          : chalk.red("✗ Error:");

    process.stderr.write(`${prefix} ${message}\n`);
    if (details) {
      process.stderr.write(`  ${chalk.dim(details)}\n`);
    }
  } else {
    // Machine-readable JSON on stderr
    const err: StructuredError = {
      error: exitCodeToName(exitCode),
      code: exitCode,
      message,
    };
    if (details) err.details = details;
    process.stderr.write(JSON.stringify(err) + "\n");
  }
}

function exitCodeToName(code: number): string {
  switch (code) {
    case EXIT_SUCCESS:
      return "success";
    case EXIT_AUTH_ERROR:
      return "auth_error";
    case EXIT_RATE_LIMITED:
      return "rate_limited";
    case EXIT_NOT_FOUND:
      return "not_found";
    default:
      return "error";
  }
}

/**
 * Map common errors to exit codes.
 */
export function classifyError(error: unknown): { message: string; exitCode: number } {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (error.name === "AuthError" || msg.includes("unauthorized") || msg.includes("401") || msg.includes("not authenticated")) {
      return { message: error.message, exitCode: EXIT_AUTH_ERROR };
    }

    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many")) {
      return { message: error.message, exitCode: EXIT_RATE_LIMITED };
    }

    if (msg.includes("not found") || msg.includes("404")) {
      return { message: error.message, exitCode: EXIT_NOT_FOUND };
    }

    return { message: error.message, exitCode: EXIT_ERROR };
  }

  return { message: String(error), exitCode: EXIT_ERROR };
}

/**
 * Handle an error: write to stderr and exit with the appropriate code.
 */
export function handleError(error: unknown): never {
  const { message, exitCode } = classifyError(error);
  exitWithError(message, exitCode);
}

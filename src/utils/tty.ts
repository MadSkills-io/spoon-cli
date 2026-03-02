/**
 * TTY detection utilities.
 *
 * When stdout is a TTY → human-readable output (tables, colors)
 * When piped → machine-readable output (JSON)
 */

export function isTTY(): boolean {
  return !!process.stdout.isTTY;
}

export function isColorSupported(): boolean {
  // Respect NO_COLOR (https://no-color.org/)
  if (process.env["NO_COLOR"] !== undefined) return false;
  // Respect FORCE_COLOR
  if (process.env["FORCE_COLOR"] !== undefined) return true;
  return isTTY();
}

/**
 * Get the default output format based on TTY detection.
 */
export function defaultFormat(): "json" | "text" {
  return isTTY() ? "text" : "json";
}

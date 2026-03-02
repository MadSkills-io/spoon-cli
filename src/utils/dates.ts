import * as chrono from "chrono-node";

/**
 * Parse a date string — supports ISO 8601 and natural language
 * ("last Monday", "2 weeks ago", "yesterday", "March 1 2024").
 *
 * Returns ISO 8601 string or undefined if parsing fails.
 */
export function parseDate(input: string): string | undefined {
  // If it already looks like ISO 8601, return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
    const d = new Date(input);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  // Try chrono-node for natural language
  const results = chrono.parseDate(input);
  if (results) {
    return results.toISOString();
  }

  return undefined;
}

/**
 * Format a date for human display.
 */
export function formatDate(input: string | undefined | null): string {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return input;

  return d.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format a date as a relative time string ("2 hours ago", "in 3 days").
 */
export function formatRelative(input: string | undefined | null): string {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return input;

  const now = Date.now();
  const diff = now - d.getTime();
  const absDiff = Math.abs(diff);
  const isPast = diff > 0;

  if (absDiff < 60_000) return "just now";

  const minutes = Math.floor(absDiff / 60_000);
  if (minutes < 60) {
    return isPast ? `${minutes}m ago` : `in ${minutes}m`;
  }

  const hours = Math.floor(absDiff / 3_600_000);
  if (hours < 24) {
    return isPast ? `${hours}h ago` : `in ${hours}h`;
  }

  const days = Math.floor(absDiff / 86_400_000);
  if (days < 30) {
    return isPast ? `${days}d ago` : `in ${days}d`;
  }

  return formatDate(input);
}

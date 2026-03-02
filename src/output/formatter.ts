import Table from "cli-table3";
import chalk from "chalk";
import { isTTY, defaultFormat } from "../utils/tty.js";
import { formatDate, formatRelative } from "../utils/dates.js";

export type OutputFormat = "json" | "table" | "csv" | "markdown" | "text";

/**
 * Resolve the output format: explicit flag > auto-detection.
 */
export function resolveFormat(explicit?: string): OutputFormat {
  if (explicit) {
    const f = explicit.toLowerCase();
    if (["json", "table", "csv", "markdown", "text"].includes(f)) {
      return f as OutputFormat;
    }
  }
  return isTTY() ? "table" : "json";
}

/**
 * Resolve format for query results (default to text in TTY).
 */
export function resolveQueryFormat(explicit?: string): OutputFormat {
  if (explicit) {
    const f = explicit.toLowerCase();
    if (["json", "table", "csv", "markdown", "text"].includes(f)) {
      return f as OutputFormat;
    }
  }
  return defaultFormat();
}

/**
 * Output data in the requested format.
 */
export function output(data: unknown, format: OutputFormat): void {
  switch (format) {
    case "json":
      outputJson(data);
      break;
    case "table":
      outputTable(data);
      break;
    case "csv":
      outputCsv(data);
      break;
    case "markdown":
      outputMarkdown(data);
      break;
    case "text":
      outputText(data);
      break;
  }
}

// --- JSON ---

function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// --- Table ---

function outputTable(data: unknown): void {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(chalk.dim("No results."));
      return;
    }

    // Auto-detect columns from first item
    const firstItem = data[0] as Record<string, unknown>;
    const columns = getDisplayColumns(firstItem);

    const table = new Table({
      head: columns.map((c) => chalk.bold(c.header)),
      style: { head: [], border: [] },
      wordWrap: true,
      wrapOnWordBoundary: true,
    });

    for (const item of data) {
      const row = item as Record<string, unknown>;
      table.push(columns.map((c) => c.format(row[c.key])));
    }

    console.log(table.toString());
  } else if (typeof data === "object" && data !== null) {
    // Single object — display as key/value table
    const record = data as Record<string, unknown>;
    const table = new Table({
      style: { head: [], border: [] },
    });

    for (const [key, value] of Object.entries(record)) {
      table.push([chalk.bold(key), formatValue(value)]);
    }

    console.log(table.toString());
  } else {
    console.log(String(data));
  }
}

// --- CSV ---

function outputCsv(data: unknown): void {
  if (!Array.isArray(data)) {
    data = [data];
  }

  const items = data as Record<string, unknown>[];
  if (items.length === 0) return;

  const keys = Object.keys(items[0] as Record<string, unknown>);
  console.log(keys.map(csvEscape).join(","));

  for (const item of items) {
    const row = keys.map((k) => csvEscape(String(item[k] ?? "")));
    console.log(row.join(","));
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// --- Markdown ---

function outputMarkdown(data: unknown): void {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log("*No results.*");
      return;
    }

    const firstItem = data[0] as Record<string, unknown>;
    const keys = Object.keys(firstItem);

    // Header
    console.log("| " + keys.join(" | ") + " |");
    console.log("| " + keys.map(() => "---").join(" | ") + " |");

    // Rows
    for (const item of data) {
      const row = item as Record<string, unknown>;
      console.log("| " + keys.map((k) => String(row[k] ?? "")).join(" | ") + " |");
    }
  } else if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && value.length > 100) {
        console.log(`## ${key}\n\n${value}\n`);
      } else {
        console.log(`**${key}:** ${formatValue(value)}`);
      }
    }
  } else {
    console.log(String(data));
  }
}

// --- Text ---

function outputText(data: unknown): void {
  if (typeof data === "string") {
    console.log(data);
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(chalk.dim("No results."));
      return;
    }

    for (const item of data) {
      outputSingleText(item);
      console.log(""); // Blank line between items
    }
  } else if (typeof data === "object" && data !== null) {
    outputSingleText(data);
  } else {
    console.log(String(data));
  }
}

function outputSingleText(item: unknown): void {
  if (typeof item !== "object" || item === null) {
    console.log(String(item));
    return;
  }

  const record = item as Record<string, unknown>;

  // If it has a title, highlight it
  if (record["title"]) {
    console.log(chalk.bold(String(record["title"])));
  }

  // If it has an ID, show it
  if (record["id"]) {
    console.log(chalk.dim(`ID: ${record["id"]}`));
  }

  // Show time
  if (record["start_time"]) {
    const time = formatDate(record["start_time"] as string);
    const relative = formatRelative(record["start_time"] as string);
    console.log(`  ${chalk.cyan("When:")} ${time} (${relative})`);
  }

  // Show attendees
  if (Array.isArray(record["attendees"]) && record["attendees"].length > 0) {
    const names = (record["attendees"] as Array<{ name?: string; email?: string }>)
      .map((a) => a.name || a.email || "Unknown")
      .join(", ");
    console.log(`  ${chalk.cyan("With:")} ${names}`);
  }

  // Show summary or notes
  for (const key of ["summary", "answer", "notes", "enhanced_notes"]) {
    if (record[key] && typeof record[key] === "string") {
      console.log(`  ${(record[key] as string).slice(0, 500)}`);
    }
  }
}

// --- Column detection for tables ---

interface TableColumn {
  key: string;
  header: string;
  format: (value: unknown) => string;
}

function getDisplayColumns(item: Record<string, unknown>): TableColumn[] {
  const columns: TableColumn[] = [];

  // Prioritize common fields
  const priorityKeys = ["id", "title", "start_time", "end_time", "attendees", "summary"];
  const allKeys = Object.keys(item);
  const orderedKeys = [
    ...priorityKeys.filter((k) => allKeys.includes(k)),
    ...allKeys.filter((k) => !priorityKeys.includes(k)),
  ];

  for (const key of orderedKeys) {
    // Skip overly long fields in tables
    const value = item[key];
    if (typeof value === "string" && value.length > 500) continue;
    if (typeof value === "object" && !Array.isArray(value) && value !== null) continue;

    columns.push({
      key,
      header: humanizeKey(key),
      format: key.includes("time") || key.includes("_at")
        ? (v) => formatDate(v as string)
        : key === "attendees"
          ? (v) => formatAttendees(v)
          : (v) => formatValue(v),
    });

    // Limit to 6 columns for readability
    if (columns.length >= 6) break;
  }

  return columns;
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatAttendees(value: unknown): string {
  if (!Array.isArray(value)) return String(value ?? "");
  return (value as Array<{ name?: string; email?: string }>)
    .map((a) => a.name || a.email || "?")
    .join(", ");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 100 ? value.slice(0, 97) + "…" : value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

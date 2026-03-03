import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const GRANOLA_DIR = join(homedir(), ".spoon");
const CONFIG_FILE = join(GRANOLA_DIR, "config.json");

export interface GranolaConfig {
  defaultFormat?: string;
  defaultLimit?: number;
  mcpUrl?: string;
}

const DEFAULT_CONFIG: GranolaConfig = {
  defaultFormat: undefined,
  defaultLimit: 20,
  mcpUrl: "https://mcp.granola.ai/mcp",
};

export function loadConfig(): GranolaConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<GranolaConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: GranolaConfig): void {
  if (!existsSync(GRANOLA_DIR)) {
    mkdirSync(GRANOLA_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  /** ISO 8601 timestamp when the token was stored */
  stored_at: string;
}

export interface StoredClientInfo {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  /** Issuer URL of the auth server that issued this client_id.
   *  Used to detect auth server migrations and invalidate stale registrations. */
  issuer?: string;
}

const GRANOLA_DIR = join(homedir(), ".spoon");
const CREDENTIALS_FILE = join(GRANOLA_DIR, "credentials.json");
const CLIENT_FILE = join(GRANOLA_DIR, "client.json");
const DISCOVERY_FILE = join(GRANOLA_DIR, "discovery.json");

function ensureDir(): void {
  if (!existsSync(GRANOLA_DIR)) {
    mkdirSync(GRANOLA_DIR, { recursive: true, mode: 0o700 });
  }
}

function writeSecure(path: string, data: unknown): void {
  ensureDir();
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  // Ensure perms even if file existed
  chmodSync(path, 0o600);
}

function readJson<T>(path: string): T | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// --- Token operations ---

export function saveTokens(tokens: StoredTokens): void {
  writeSecure(CREDENTIALS_FILE, tokens);
}

export function loadTokens(): StoredTokens | undefined {
  return readJson<StoredTokens>(CREDENTIALS_FILE);
}

export function clearTokens(): void {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      writeFileSync(CREDENTIALS_FILE, "{}", { mode: 0o600 });
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      unlinkSync(CREDENTIALS_FILE);
    }
  } catch {
    // Best effort
  }
}

/**
 * Check if stored tokens are expired or will expire within `bufferSeconds`.
 */
export function isTokenExpired(tokens: StoredTokens, bufferSeconds = 300): boolean {
  if (!tokens.expires_in || !tokens.stored_at) return false; // Can't tell; assume valid
  const storedAt = new Date(tokens.stored_at).getTime();
  const expiresAt = storedAt + tokens.expires_in * 1000;
  const now = Date.now();
  return now >= expiresAt - bufferSeconds * 1000;
}

// --- Client info operations ---

export function saveClientInfo(info: StoredClientInfo): void {
  writeSecure(CLIENT_FILE, info);
}

export function loadClientInfo(): StoredClientInfo | undefined {
  return readJson<StoredClientInfo>(CLIENT_FILE);
}

export function clearClientInfo(): void {
  try {
    if (existsSync(CLIENT_FILE)) {
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      unlinkSync(CLIENT_FILE);
    }
  } catch {
    // Best effort
  }
}

// --- Discovery cache ---

export function saveDiscoveryState(state: unknown): void {
  writeSecure(DISCOVERY_FILE, state);
}

export function loadDiscoveryState(): unknown {
  return readJson(DISCOVERY_FILE);
}

// --- PKCE verifier (transient, stored during auth flow) ---

const VERIFIER_FILE = join(GRANOLA_DIR, ".code_verifier");

export function saveCodeVerifier(verifier: string): void {
  writeSecure(VERIFIER_FILE, { code_verifier: verifier });
}

export function loadCodeVerifier(): string | undefined {
  const data = readJson<{ code_verifier: string }>(VERIFIER_FILE);
  return data?.code_verifier;
}

export function clearCodeVerifier(): void {
  try {
    if (existsSync(VERIFIER_FILE)) {
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      unlinkSync(VERIFIER_FILE);
    }
  } catch {
    // Best effort
  }
}

// --- Utility ---

export function getGranolaDir(): string {
  return GRANOLA_DIR;
}

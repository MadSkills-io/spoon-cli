import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import open from "open";
import { generateVerifier, generateChallenge } from "./pkce.js";
import { startCallbackServer } from "./callback-server.js";
import {
  saveTokens,
  loadTokens,
  clearTokens,
  saveClientInfo,
  loadClientInfo,
  saveCodeVerifier,
  loadCodeVerifier,
  clearCodeVerifier,
  saveDiscoveryState,
  loadDiscoveryState,
  isTokenExpired,
  type StoredTokens,
  type StoredClientInfo,
} from "./token-store.js";

const GRANOLA_MCP_URL = "https://mcp.granola.ai";
const DEFAULT_SCOPES = "openid profile email offline_access";

// OAuth endpoint defaults (fallback if .well-known 404s)
const DEFAULT_ENDPOINTS = {
  authorization_endpoint: `${GRANOLA_MCP_URL}/authorize`,
  token_endpoint: `${GRANOLA_MCP_URL}/token`,
  registration_endpoint: `${GRANOLA_MCP_URL}/register`,
  revocation_endpoint: `${GRANOLA_MCP_URL}/revoke`,
};

// --- OAuth metadata discovery ---

export interface AuthServerMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export async function discoverMetadata(): Promise<AuthServerMetadata> {
  try {
    const res = await fetch(
      `${GRANOLA_MCP_URL}/.well-known/oauth-authorization-server`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (res.ok) {
      return (await res.json()) as AuthServerMetadata;
    }
  } catch {
    // Fall through to defaults
  }

  return DEFAULT_ENDPOINTS;
}

// --- Dynamic Client Registration ---

export async function registerClient(
  metadata: AuthServerMetadata,
  redirectUri: string
): Promise<StoredClientInfo> {
  // Use cached registration only if it was issued by the same auth server.
  // If the issuer has changed (e.g. mcp.granola.ai → mcp-auth.granola.ai)
  // the old client_id is invalid and we must re-register.
  const cached = loadClientInfo();
  if (cached) {
    const cachedIssuer = cached.issuer ?? "";
    const currentIssuer = metadata.issuer ?? new URL(metadata.token_endpoint).origin;
    if (!cachedIssuer || cachedIssuer === currentIssuer) {
      return cached;
    }
    // Issuer mismatch — clear stale registration and re-register
    saveClientInfo(null as unknown as StoredClientInfo); // will be overwritten below
  }

  const endpoint = metadata.registration_endpoint ?? DEFAULT_ENDPOINTS.registration_endpoint;

  // OAuthClientMetadata.redirect_uris is typed as URL[] by Zod but
  // the actual JSON serialization needs strings. Cast accordingly.
  const clientMetadata = {
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Granola CLI",
    client_uri: "https://github.com/granola-cli",
  } as unknown as OAuthClientMetadata;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clientMetadata),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DCR failed (${res.status}): ${body}`);
  }

  const info = (await res.json()) as StoredClientInfo;
  // Store the issuer so we can detect auth server migrations on future logins.
  info.issuer = metadata.issuer ?? new URL(metadata.token_endpoint).origin;
  saveClientInfo(info);
  return info;
}

// --- Token exchange ---

export async function exchangeCodeForTokens(
  metadata: AuthServerMetadata,
  clientId: string,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<StoredTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const res = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const tokens = (await res.json()) as OAuthTokens;
  const stored: StoredTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type ?? "Bearer",
    expires_in: tokens.expires_in,
    scope: tokens.scope,
    stored_at: new Date().toISOString(),
  };

  saveTokens(stored);
  clearCodeVerifier();
  return stored;
}

// --- Token refresh ---

export async function refreshAccessToken(
  metadata: AuthServerMetadata,
  clientId: string,
  refreshToken: string
): Promise<StoredTokens> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const tokens = (await res.json()) as OAuthTokens;
  const stored: StoredTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? refreshToken,
    token_type: tokens.token_type ?? "Bearer",
    expires_in: tokens.expires_in,
    scope: tokens.scope,
    stored_at: new Date().toISOString(),
  };

  saveTokens(stored);
  return stored;
}

// --- Token revocation ---

export async function revokeToken(
  metadata: AuthServerMetadata,
  clientId: string,
  token: string,
  tokenTypeHint: "access_token" | "refresh_token" = "access_token"
): Promise<void> {
  const endpoint = metadata.revocation_endpoint;
  if (!endpoint) return;

  const params = new URLSearchParams({
    token,
    token_type_hint: tokenTypeHint,
    client_id: clientId,
  });

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Best effort — revocation failure is not critical
  }
}

// --- Full login flow ---

export async function login(): Promise<StoredTokens> {
  const metadata = await discoverMetadata();

  // Start callback server first to get the port
  const { port, waitForCallback } = await startCallbackServer({
    timeoutMs: 120_000,
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Dynamic client registration
  const clientInfo = await registerClient(metadata, redirectUri);

  // PKCE
  const codeVerifier = generateVerifier();
  const codeChallenge = generateChallenge(codeVerifier);
  saveCodeVerifier(codeVerifier);

  // Build authorization URL
  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientInfo.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", DEFAULT_SCOPES);

  // Open browser
  console.error("Opening browser for authentication...");
  await open(authUrl.toString());
  console.error("Waiting for authorization (timeout: 120s)...");

  // Wait for callback
  const { code } = await waitForCallback();

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(
    metadata,
    clientInfo.client_id,
    code,
    codeVerifier,
    redirectUri
  );

  return tokens;
}

// --- Logout ---

export async function logout(): Promise<void> {
  const tokens = loadTokens();
  const clientInfo = loadClientInfo();
  const metadata = await discoverMetadata();

  if (tokens && clientInfo) {
    // Revoke refresh token first (more important), then access token
    if (tokens.refresh_token) {
      await revokeToken(metadata, clientInfo.client_id, tokens.refresh_token, "refresh_token");
    }
    await revokeToken(metadata, clientInfo.client_id, tokens.access_token, "access_token");
  }

  clearTokens();
}

// --- Get valid access token (with auto-refresh) ---

export async function getAccessToken(): Promise<string> {
  // Check for env var override first
  const envToken = process.env["GRANOLA_TOKEN"];
  if (envToken) return envToken;

  const tokens = loadTokens();
  if (!tokens?.access_token) {
    throw new AuthError("Not authenticated. Run: spoon auth login");
  }

  // Auto-refresh if expired or expiring within 5 minutes
  if (isTokenExpired(tokens, 300) && tokens.refresh_token) {
    const clientInfo = loadClientInfo();
    if (clientInfo) {
      try {
        const metadata = await discoverMetadata();
        const refreshed = await refreshAccessToken(
          metadata,
          clientInfo.client_id,
          tokens.refresh_token
        );
        return refreshed.access_token;
      } catch {
        // If refresh fails, try the existing token — server will 401 if truly expired
      }
    }
  }

  return tokens.access_token;
}

// --- Auth status ---

export interface AuthStatus {
  authenticated: boolean;
  hasEnvToken: boolean;
  accessToken?: string;
  expiresAt?: string;
  hasRefreshToken: boolean;
  clientId?: string;
}

export function getAuthStatus(): AuthStatus {
  const envToken = process.env["GRANOLA_TOKEN"];
  if (envToken) {
    return {
      authenticated: true,
      hasEnvToken: true,
      hasRefreshToken: false,
      accessToken: maskToken(envToken),
    };
  }

  const tokens = loadTokens();
  const clientInfo = loadClientInfo();

  if (!tokens?.access_token) {
    return {
      authenticated: false,
      hasEnvToken: false,
      hasRefreshToken: false,
    };
  }

  let expiresAt: string | undefined;
  if (tokens.expires_in && tokens.stored_at) {
    const storedAt = new Date(tokens.stored_at).getTime();
    expiresAt = new Date(storedAt + tokens.expires_in * 1000).toISOString();
  }

  return {
    authenticated: !isTokenExpired(tokens, 0),
    hasEnvToken: false,
    accessToken: maskToken(tokens.access_token),
    expiresAt,
    hasRefreshToken: !!tokens.refresh_token,
    clientId: clientInfo?.client_id,
  };
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "…" + token.slice(-4);
}

// --- OAuthClientProvider for MCP SDK ---

export function createOAuthProvider(): OAuthClientProvider {
  return {
    get redirectUrl(): string | URL | undefined {
      // Will be set dynamically during login; undefined for non-interactive
      return undefined;
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "Granola CLI",
      } as unknown as OAuthClientMetadata;
    },

    clientInformation() {
      const info = loadClientInfo();
      return info ? { client_id: info.client_id, client_secret: info.client_secret } : undefined;
    },

    tokens() {
      const stored = loadTokens();
      if (!stored) return undefined;
      return {
        access_token: stored.access_token,
        token_type: stored.token_type,
        refresh_token: stored.refresh_token,
        expires_in: stored.expires_in,
        scope: stored.scope,
      };
    },

    saveTokens(tokens: OAuthTokens) {
      saveTokens({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type ?? "Bearer",
        expires_in: tokens.expires_in,
        scope: tokens.scope,
        stored_at: new Date().toISOString(),
      });
    },

    redirectToAuthorization(authorizationUrl: URL) {
      open(authorizationUrl.toString());
    },

    saveCodeVerifier(cv: string) {
      saveCodeVerifier(cv);
    },

    codeVerifier() {
      return loadCodeVerifier() ?? "";
    },

    saveClientInformation(info) {
      saveClientInfo({
        client_id: info.client_id,
        client_secret: info.client_secret,
      });
    },

    saveDiscoveryState(state) {
      saveDiscoveryState(state);
    },

    discoveryState() {
      return loadDiscoveryState() as ReturnType<NonNullable<OAuthClientProvider["discoveryState"]>>;
    },
  };
}

// --- Custom error ---

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

# Authentication: OAuth 2.1 + PKCE + DCR

## Overview

The Granola CLI authenticates users via **OAuth 2.1** with:

- **PKCE** (Proof Key for Code Exchange) — prevents authorization code interception attacks; required for public clients (no client secret)
- **Dynamic Client Registration (DCR)** — the CLI registers itself as an OAuth client at first run; no pre-provisioned `client_id` needed
- **Browser-based authorization flow** — user authenticates in their default browser; CLI receives the callback on a local HTTP server

This is the same pattern used by the GitHub CLI (`gh auth login`), Stripe CLI, and other modern developer tools.

---

## Full Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   OAuth 2.1 + PKCE + DCR                    │
│                                                             │
│  1. Discovery                                               │
│     GET /.well-known/oauth-authorization-server             │
│     → endpoints: /authorize, /token, /register, /revoke    │
│     → 404: use conventional defaults                        │
│                                                             │
│  2. Dynamic Client Registration (DCR)                       │
│     POST /register                                          │
│     { client_name, redirect_uris, grant_types,              │
│       token_endpoint_auth_method: "none" }                  │
│     → { client_id }   (cached in ~/.granola/client.json)   │
│                                                             │
│  3. PKCE Generation                                         │
│     code_verifier  = random(96 bytes) → base64url           │
│     code_challenge = SHA-256(verifier) → base64url          │
│                                                             │
│  4. Start Local Callback Server                             │
│     HTTP server on random available port                    │
│     redirect_uri = http://localhost:{port}/callback         │
│                                                             │
│  5. Open Browser                                            │
│     GET /authorize?                                         │
│       response_type=code                                    │
│       &client_id={client_id}                                │
│       &redirect_uri=http://localhost:{port}/callback        │
│       &code_challenge={challenge}                           │
│       &code_challenge_method=S256                           │
│       &scope=openid profile email                           │
│       &state={random}                                       │
│                                                             │
│  6. User Authenticates in Browser                           │
│     → browser redirects to localhost callback               │
│     → callback server receives: ?code=AUTH_CODE&state=...   │
│                                                             │
│  7. Token Exchange                                          │
│     POST /token                                             │
│     { grant_type=authorization_code, code, redirect_uri,   │
│       client_id, code_verifier }                            │
│     → { access_token, refresh_token, expires_in }          │
│                                                             │
│  8. Store Credentials                                       │
│     keytar (OS keychain) or ~/.granola/credentials.json    │
└─────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Implementation

### Step 1: OAuth Server Discovery

```typescript
// src/auth/oauth.ts
const DISCOVERY_URL = "https://mcp.granola.ai/.well-known/oauth-authorization-server";
const DEFAULTS = {
  authorization_endpoint: "https://mcp.granola.ai/authorize",
  token_endpoint: "https://mcp.granola.ai/token",
  registration_endpoint: "https://mcp.granola.ai/register",
  revocation_endpoint: "https://mcp.granola.ai/revoke",
};

async function discoverEndpoints(): Promise<OAuthMetadata> {
  try {
    const res = await fetch(DISCOVERY_URL);
    if (res.ok) return res.json();
  } catch {}
  // Fall back to conventional defaults on 404 or network error
  return DEFAULTS;
}
```

The discovery document (RFC 8414) contains:
- `authorization_endpoint`
- `token_endpoint`
- `registration_endpoint`
- `revocation_endpoint`
- `code_challenge_methods_supported` (should include `S256`)

### Step 2: Dynamic Client Registration

DCR (RFC 7591) allows the CLI to register itself as an OAuth client without a pre-provisioned `client_id`. This is required by the MCP OAuth 2.1 specification for public clients.

```typescript
async function registerClient(registrationEndpoint: string): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Granola CLI",
      redirect_uris: ["http://localhost"],  // port filled in at runtime
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",  // public client — no secret
    }),
  });
  const { client_id } = await res.json();
  return client_id;
}
```

The returned `client_id` is cached in `~/.granola/client.json`:

```json
{
  "client_id": "abc-123-xyz",
  "registration_endpoint": "https://mcp.granola.ai/register",
  "registered_at": "2026-03-02T10:00:00Z"
}
```

If `~/.granola/client.json` exists and is less than 30 days old, re-registration is skipped.

### Step 3: PKCE Generation

PKCE (RFC 7636) prevents authorization code interception by binding the code to a secret only the CLI knows.

```typescript
// src/auth/pkce.ts
import { randomBytes, createHash } from "crypto";

export function generateVerifier(): string {
  // 96 bytes → 128 base64url characters (well within 43-128 char spec limit)
  return randomBytes(96)
    .toString("base64url");
}

export function generateChallenge(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
}
```

**Security note:** `base64url` encoding (RFC 4648 §5) uses `-` and `_` instead of `+` and `/`, and omits padding. This is required by the PKCE spec.

### Step 4: Local Callback Server

The CLI starts a temporary HTTP server to receive the OAuth redirect:

```typescript
// src/auth/callback-server.ts
import { createServer } from "http";
import { AddressInfo } from "net";

interface CallbackResult {
  code: string;
  state: string;
}

export async function startCallbackServer(
  expectedState: string,
  timeoutMs = 120_000
): Promise<{ port: number; waitForCallback: () => Promise<CallbackResult> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => { /* ... */ });
    server.listen(0, "localhost", () => {  // port 0 = OS assigns random available port
      const { port } = server.address() as AddressInfo;
      resolve({ port, waitForCallback });
    });
  });
}
```

**Key details:**
- Port `0` → OS assigns a random available port (avoids conflicts)
- Server timeout: 120 seconds (if user doesn't complete auth, exit gracefully)
- On receiving the callback: validate the `state` parameter (CSRF protection), extract `code`, close the server, return a success page to the browser
- Browser success page: minimal HTML telling the user to return to the terminal

### Step 5 & 6: Browser Open + Auth Code Receipt

```typescript
import { open } from "open";  // or platform-specific: xdg-open, open, start

const state = randomBytes(16).toString("hex");  // CSRF token
const authUrl = new URL(endpoints.authorization_endpoint);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", `http://localhost:${port}/callback`);
authUrl.searchParams.set("code_challenge", challenge);
authUrl.searchParams.set("code_challenge_method", "S256");
authUrl.searchParams.set("scope", "openid profile email");
authUrl.searchParams.set("state", state);

console.log("Opening browser for authentication...");
console.log("If the browser doesn't open, visit:");
console.log(`  ${authUrl.toString()}\n`);

await open(authUrl.toString());
const { code } = await waitForCallback();
```

### Step 7: Token Exchange

```typescript
async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  verifier: string,
  clientId: string,
  redirectUri: string
): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new AuthError(`Token exchange failed: ${res.status}`);
  return res.json();
}
```

**Response shape:**
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 604800,
  "refresh_token": "rt_abc123xyz",
  "scope": "openid profile email"
}
```

### Step 8: Credential Storage

```typescript
// src/auth/token-store.ts

interface StoredCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;  // ISO 8601
  user_email?: string;
}

const KEYTAR_SERVICE = "granola-cli";
const KEYTAR_ACCOUNT = "default";

export async function storeCredentials(creds: StoredCredentials): Promise<void> {
  try {
    const keytar = await import("keytar");
    await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(creds));
    return;
  } catch {
    // keytar not available (e.g., headless Linux, Docker)
  }
  // File fallback
  const credFile = path.join(os.homedir(), ".granola", "credentials.json");
  await fs.mkdir(path.dirname(credFile), { recursive: true });
  await fs.writeFile(credFile, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  // Try keytar first, then file fallback
  // ...
}
```

**Storage priority:**

| Method | Platform | Notes |
|--------|----------|-------|
| macOS Keychain (keytar) | macOS | Preferred; secure enclave backed |
| Secret Service (keytar) | Linux (GNOME/KDE) | D-Bus based; requires desktop session |
| Windows Credential Store (keytar) | Windows | DPAPI backed |
| `~/.granola/credentials.json` | All platforms | Fallback; `chmod 0600` |

**File permissions:** The credentials file is created with mode `0600` (owner read/write only). The directory `~/.granola/` is created with mode `0700`.

---

## Token Refresh

### Proactive Refresh (5-minute window)

Before each MCP request, the token's expiry is checked:

```typescript
function isTokenExpiringSoon(credentials: StoredCredentials): boolean {
  const expiresAt = new Date(credentials.expires_at).getTime();
  const fiveMinutes = 5 * 60 * 1000;
  return Date.now() + fiveMinutes >= expiresAt;
}

async function getValidToken(): Promise<string> {
  const creds = await loadCredentials();
  if (!creds) throw new AuthError("Not authenticated", 2);

  if (isTokenExpiringSoon(creds)) {
    return refreshToken(creds.refresh_token);
  }
  return creds.access_token;
}
```

### Reactive Refresh (401 Recovery)

If the MCP server returns 401 (token expired or invalidated server-side):

```typescript
// In McpClient.callTool():
try {
  return await this.client.callTool(name, args);
} catch (err) {
  if (err.statusCode === 401 && !this.alreadyRetried) {
    this.alreadyRetried = true;
    await this.refreshAndReinject();
    return await this.client.callTool(name, args);
  }
  throw err;
}
```

### Refresh Request

```typescript
async function refreshToken(refreshToken: string): Promise<string> {
  const res = await fetch(endpoints.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    // Refresh token revoked or expired — user must re-login
    await clearCredentials();
    throw new AuthError("Session expired. Run `granola auth login` to re-authenticate.", 2);
  }
  const tokens = await res.json();
  await storeCredentials({ ...tokens, expires_at: computeExpiresAt(tokens.expires_in) });
  return tokens.access_token;
}
```

---

## Environment Variable Override

For CI/CD pipelines, automated scripts, and headless environments, the OAuth flow can be bypassed entirely:

```bash
export GRANOLA_TOKEN="eyJhbGciOiJSUzI1NiJ9..."
granola meetings list  # Uses the env var token directly
```

**Implementation:**
```typescript
function getTokenFromEnv(): string | null {
  return process.env.GRANOLA_TOKEN ?? null;
}

// In getValidToken():
const envToken = getTokenFromEnv();
if (envToken) return envToken;  // Skip all OAuth logic
```

**Notes on `GRANOLA_TOKEN`:**
- No automatic refresh; if the token expires, the user must update the env var
- No revocation on `granola auth logout` (the env var is not managed by the CLI)
- Takes precedence over stored credentials

---

## Token Security Considerations

| Concern | Mitigation |
|---------|------------|
| Token in process args | Never accepted as CLI flag; only env var or file/keychain |
| Token in shell history | `GRANOLA_TOKEN` assignment doesn't appear in history if prefixed with a space (bash) |
| File credentials world-readable | `chmod 0600` on `credentials.json`; `chmod 0700` on `~/.granola/` |
| Token in logs | Debug output never prints full token; only first 8 characters |
| CSRF in OAuth callback | `state` parameter validated; mismatch → reject + log warning |
| Code interception | PKCE `code_verifier` makes intercepted codes useless |

---

## File Layout: `~/.granola/`

```
~/.granola/
├── config.json          (mode 0600) — CLI settings
├── credentials.json     (mode 0600) — token storage fallback
└── client.json          (mode 0600) — cached DCR client_id
```

Directory mode: `0700` (owner only).

---

## Error Scenarios

| Scenario | Behavior |
|----------|----------|
| User closes browser without authenticating | Callback server times out after 120s; exit code 2 |
| Authorization server unreachable | Network error printed to stderr; exit code 1 |
| DCR fails (endpoint returns 4xx) | Error printed; fall back to empty `client_id`; may cause subsequent failures |
| Token exchange fails | Error message with HTTP status; exit code 2 |
| Refresh token expired | Stored credentials cleared; user prompted to run `auth login`; exit code 2 |
| keytar native module unavailable | Falls back to file storage silently (no error) |
| credentials file not found | User treated as unauthenticated; exit code 2 |

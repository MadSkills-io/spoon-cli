import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

export interface CallbackResult {
  code: string;
  state?: string;
}

/**
 * Start a local HTTP server to receive the OAuth callback.
 *
 * Returns the port number and a promise that resolves when the
 * authorization code is received (or rejects on timeout/error).
 */
export async function startCallbackServer(options: {
  timeoutMs?: number;
  expectedState?: string;
} = {}): Promise<{
  port: number;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
}> {
  const { timeoutMs = 120_000, expectedState } = options;

  let resolveCallback: (result: CallbackResult) => void;
  let rejectCallback: (error: Error) => void;

  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      const errorDescription = url.searchParams.get("error_description") ?? error;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(errorPage(errorDescription));
      rejectCallback(new Error(`OAuth error: ${errorDescription}`));
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(errorPage("Missing authorization code"));
      rejectCallback(new Error("Missing authorization code in callback"));
      return;
    }

    const state = url.searchParams.get("state") ?? undefined;
    if (expectedState && state !== expectedState) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(errorPage("State mismatch — possible CSRF attack"));
      rejectCallback(new Error("OAuth state mismatch"));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(successPage());
    resolveCallback({ code, state });
  });

  // Listen on a random available port
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  // Timeout
  const timeout = setTimeout(() => {
    rejectCallback(new Error(`OAuth callback timed out after ${timeoutMs / 1000}s`));
    server.close();
  }, timeoutMs);

  const close = () => {
    clearTimeout(timeout);
    server.close();
  };

  const waitForCallback = async () => {
    try {
      const result = await callbackPromise;
      return result;
    } finally {
      close();
    }
  };

  return { port, waitForCallback, close };
}

function successPage(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Granola CLI — Authenticated</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa;">
  <div style="text-align: center; max-width: 400px;">
    <h1 style="color: #22c55e; font-size: 48px; margin-bottom: 8px;">✓</h1>
    <h2>Authentication Successful</h2>
    <p style="color: #6b7280;">You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Granola CLI — Error</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa;">
  <div style="text-align: center; max-width: 400px;">
    <h1 style="color: #ef4444; font-size: 48px; margin-bottom: 8px;">✗</h1>
    <h2>Authentication Failed</h2>
    <p style="color: #6b7280;">${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c] ?? c;
  });
}

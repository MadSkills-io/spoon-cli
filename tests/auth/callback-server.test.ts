import { describe, it, expect } from "vitest";
import { startCallbackServer } from "../../src/auth/callback-server.js";

describe("OAuth Callback Server", () => {
  it("starts on an available port", async () => {
    const { port, close } = await startCallbackServer({ timeoutMs: 5000 });
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    close();
  });

  it("receives authorization code from callback", async () => {
    const { port, waitForCallback } = await startCallbackServer({ timeoutMs: 5000 });
    const callbackUrl = `http://127.0.0.1:${port}/callback?code=test-auth-code&state=test-state`;

    const [result] = await Promise.all([
      waitForCallback(),
      fetch(callbackUrl),
    ]);

    expect(result.code).toBe("test-auth-code");
    expect(result.state).toBe("test-state");
  });

  it("rejects errors in callback", async () => {
    const { port, waitForCallback } = await startCallbackServer({ timeoutMs: 5000 });
    const errorUrl = `http://127.0.0.1:${port}/callback?error=access_denied&error_description=User+denied+access`;

    await expect(
      Promise.all([
        waitForCallback(),
        fetch(errorUrl),
      ])
    ).rejects.toThrow();
  });

  it("returns 404 for non-callback paths", async () => {
    const { port, close } = await startCallbackServer({ timeoutMs: 5000 });
    const res = await fetch(`http://127.0.0.1:${port}/other-path`);
    expect(res.status).toBe(404);
    close();
  });
});

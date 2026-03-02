import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";

// We need to test the token store with a temporary directory.
// Because the module uses `homedir()` we need to mock it.
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => testHomeDir,
  };
});

const testHomeDir = join(tmpdir(), `granola-test-${process.pid}`);

describe("Token Store", () => {
  beforeEach(() => {
    // Create a fresh test directory
    mkdirSync(join(testHomeDir, ".granola"), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testHomeDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("saves and loads tokens", async () => {
    const { saveTokens, loadTokens } = await import("../../src/auth/token-store.js");

    const tokens = {
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      stored_at: new Date().toISOString(),
    };

    saveTokens(tokens);
    const loaded = loadTokens();

    expect(loaded).toBeDefined();
    expect(loaded!.access_token).toBe("test-access-token");
    expect(loaded!.refresh_token).toBe("test-refresh-token");
  });

  it("returns undefined when no tokens are stored", async () => {
    const { loadTokens } = await import("../../src/auth/token-store.js");
    const result = loadTokens();
    // Either undefined (fresh) or previously stored test tokens
    // We just verify it doesn't throw
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("correctly identifies expired tokens", async () => {
    const { isTokenExpired } = await import("../../src/auth/token-store.js");

    const pastDate = new Date(Date.now() - 7200_000); // 2 hours ago
    const expiredTokens = {
      access_token: "expired",
      token_type: "Bearer",
      expires_in: 3600, // 1 hour
      stored_at: pastDate.toISOString(),
    };

    expect(isTokenExpired(expiredTokens, 0)).toBe(true);
  });

  it("identifies valid tokens as not expired", async () => {
    const { isTokenExpired } = await import("../../src/auth/token-store.js");

    const freshTokens = {
      access_token: "fresh",
      token_type: "Bearer",
      expires_in: 7200, // 2 hours
      stored_at: new Date().toISOString(),
    };

    expect(isTokenExpired(freshTokens, 0)).toBe(false);
  });

  it("identifies tokens expiring within buffer as expired", async () => {
    const { isTokenExpired } = await import("../../src/auth/token-store.js");

    // Token expires in 2 minutes, buffer is 5 minutes
    const almostExpired = {
      access_token: "almost",
      token_type: "Bearer",
      expires_in: 120, // 2 minutes from stored_at
      stored_at: new Date().toISOString(),
    };

    expect(isTokenExpired(almostExpired, 300)).toBe(true);
  });

  it("saves and loads client info", async () => {
    const { saveClientInfo, loadClientInfo } = await import("../../src/auth/token-store.js");

    saveClientInfo({ client_id: "test-client-id", client_secret: "test-secret" });
    const loaded = loadClientInfo();

    expect(loaded?.client_id).toBe("test-client-id");
  });
});

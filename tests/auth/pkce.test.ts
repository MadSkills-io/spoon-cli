import { describe, it, expect } from "vitest";
import { generateVerifier, generateChallenge } from "../../src/auth/pkce.js";
import { createHash } from "node:crypto";

describe("PKCE", () => {
  describe("generateVerifier()", () => {
    it("returns a string of the default length (64)", () => {
      const v = generateVerifier();
      expect(v).toHaveLength(64);
    });

    it("returns a string of a custom length", () => {
      const v = generateVerifier(96);
      expect(v).toHaveLength(96);
    });

    it("contains only base64url characters", () => {
      const v = generateVerifier(128);
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("generates different values each call", () => {
      const a = generateVerifier();
      const b = generateVerifier();
      expect(a).not.toBe(b);
    });
  });

  describe("generateChallenge()", () => {
    it("returns a base64url SHA256 hash of the verifier", () => {
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const challenge = generateChallenge(verifier);

      // Verify manually
      const expected = createHash("sha256")
        .update(verifier)
        .digest("base64url");

      expect(challenge).toBe(expected);
    });

    it("returns base64url characters only", () => {
      const challenge = generateChallenge(generateVerifier());
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("does not include padding characters", () => {
      const challenge = generateChallenge(generateVerifier());
      expect(challenge).not.toContain("=");
    });

    it("is deterministic for the same input", () => {
      const verifier = generateVerifier();
      expect(generateChallenge(verifier)).toBe(generateChallenge(verifier));
    });
  });
});

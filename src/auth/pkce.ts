import { randomBytes, createHash } from "node:crypto";

/**
 * Generate a cryptographically random PKCE code verifier.
 * RFC 7636 §4.1: 43-128 chars from [A-Z a-z 0-9 - . _ ~]
 */
export function generateVerifier(length = 64): string {
  return randomBytes(length)
    .toString("base64url")
    .slice(0, length);
}

/**
 * Generate a PKCE code challenge from a verifier.
 * RFC 7636 §4.2: BASE64URL(SHA256(code_verifier))
 */
export function generateChallenge(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

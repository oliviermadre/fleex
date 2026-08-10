import { randomBytes } from 'node:crypto';

/**
 * Mints a routine's webhook capability token: 256 bits, base64url, so it is
 * both URL-safe and beyond guessing. The token IS the auth model — it is the
 * one credential every webhook sender supports (a path), which is what keeps
 * source-specific signature schemes (GitHub HMAC, Linear, Jira JWT…) out of
 * the zero-code-per-source contract.
 */
export function mintWebhookSecret(): string {
  return randomBytes(32).toString('base64url');
}

import { createHash } from 'node:crypto';

/**
 * Fixed Fleex namespace for deriving deterministic session ids.
 * Any constant 16-byte value is a valid RFC 4122 §4.3 namespace; this one is
 * Fleex-specific so derived ids never collide with other UUIDv5 namespaces.
 */
const FLEEX_SESSION_NAMESPACE = 'f1eef1ee-0000-4000-8000-000000000001';
const NAMESPACE_BYTES = Buffer.from(FLEEX_SESSION_NAMESPACE.replace(/-/g, ''), 'hex');

/**
 * Derive a stable, deterministic session id from a tmux session name (RFC 4122 UUIDv5).
 *
 * The tmux name is unique (tmux enforces it) and stable over time and across Fleex
 * instances, so deriving the id from it — instead of `randomUUID()` — makes the id
 * reproducible: rediscovering the same tmux session (even from another instance sharing
 * the same Supabase store) yields exactly the same id.
 *
 * Why this matters: a sidebar terminal encodes its parent's session id inside its own
 * tmux name. When the parent session is evicted from the store and re-discovered, a random
 * id would no longer match the id encoded in the sidebar name, so the reaper would kill the
 * sidebar even though its tmux parent is still alive. A deterministic id keeps that link
 * valid for the parent's whole lifetime.
 *
 * Returns a canonical lowercase hyphenated UUID so `SessionNamingService.parseSidebarParentId`
 * (a UUID regex) can recover it from a sidebar tmux name.
 */
export function sessionIdFromTmuxName(tmuxName: string): string {
  const hash = createHash('sha1')
    .update(NAMESPACE_BYTES)
    .update(Buffer.from(tmuxName, 'utf8'))
    .digest();

  // Use the first 16 bytes of the SHA-1 digest as the UUID.
  const bytes = hash.subarray(0, 16);
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x50; // version 5 (high nibble of byte 6)
  bytes[8] = (b8 & 0x3f) | 0x80; // RFC 4122 variant (high bits of byte 8)

  const hex = bytes.toString('hex');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

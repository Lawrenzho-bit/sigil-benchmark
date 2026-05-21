/**
 * API token crypto. The plaintext secret is shown to the creator exactly once;
 * only its SHA-256 hash is persisted. Lookups hash the presented token and
 * match by hash, so a database leak never exposes usable tokens.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_PREFIX = 'iat_'; // "internal admin token"
const PREFIX_DISPLAY_LEN = 12; // chars stored for UI display, e.g. "iat_a1b2c3d4"

export interface GeneratedToken {
  /** Full secret — returned to the caller once, never stored. */
  plaintext: string;
  /** SHA-256 hex digest, stored in api_tokens.tokenHash. */
  hash: string;
  /** Non-secret leading chars, stored for display in the UI. */
  prefix: string;
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext.trim()).digest('hex');
}

export function generateToken(): GeneratedToken {
  const plaintext = TOKEN_PREFIX + randomBytes(24).toString('hex');
  return {
    plaintext,
    hash: hashToken(plaintext),
    prefix: plaintext.slice(0, PREFIX_DISPLAY_LEN),
  };
}

/** Constant-time comparison of two hex digests of equal length. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function looksLikeToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

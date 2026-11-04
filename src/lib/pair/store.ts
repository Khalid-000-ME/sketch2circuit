/**
 * Phone-to-desktop pairing sessions.
 *
 * A session is a short-lived mailbox. The desktop creates one and shows its token
 * as a QR code; the phone opens the link and drops a photo in; the desktop picks
 * it up. Nothing is identified by anything but the token, so the token is the
 * whole security story: 128 bits from the system CSPRNG, unguessable, expiring.
 *
 * This lives in process memory. That is correct for what it is used for — one
 * server, two devices on the same network, ten minutes — and wrong for a
 * deployment that runs several instances, where the phone's request and the
 * desktop's poll can land on different ones. That case needs a shared store.
 */

import { randomBytes } from 'node:crypto';

/** 16 random bytes as base64url is 22 characters. Anything else is not a token. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export const MAX_PAIR_BYTES = 10 * 1024 * 1024;
const TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 200;

export interface PairedImage {
  data: Buffer;
  mime: string;
  receivedAt: number;
}

interface Session {
  createdAt: number;
  expiresAt: number;
  image: PairedImage | null;
}

export type PairStatus = 'waiting' | 'ready' | 'expired';

// On globalThis so a hot reload or a second bundle of this module in the same
// process still sees the same sessions, instead of silently starting an empty set.
const globalStore = globalThis as typeof globalThis & { __sketchitPairs?: Map<string, Session> };
const sessions: Map<string, Session> = (globalStore.__sketchitPairs ??= new Map());

function prune(now = Date.now()) {
  for (const [token, s] of sessions) if (s.expiresAt <= now) sessions.delete(token);
  // A cap, so a loop of requests cannot grow the process without limit. The
  // oldest go first; they are the likeliest to be abandoned.
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function createSession(): { token: string; expiresAt: number } {
  prune();
  const token = randomBytes(16).toString('base64url');
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  sessions.set(token, { createdAt: now, expiresAt, image: null });
  return { token, expiresAt };
}

export function statusOf(token: string): { status: PairStatus; expiresAt: number | null } {
  prune();
  const s = sessions.get(token);
  if (!s) return { status: 'expired', expiresAt: null };
  return { status: s.image ? 'ready' : 'waiting', expiresAt: s.expiresAt };
}

/** Stores the photo, replacing an earlier one, which is what a retake is. */
export function putImage(token: string, data: Buffer, mime: string): boolean {
  prune();
  const s = sessions.get(token);
  if (!s) return false;
  s.image = { data, mime, receivedAt: Date.now() };
  return true;
}

/**
 * Hands the photo over once and closes the session. Once is the point: the image
 * is the user's sketch, and it should not sit on the server after it has been used.
 */
export function takeImage(token: string): PairedImage | null {
  prune();
  const s = sessions.get(token);
  if (!s?.image) return null;
  const image = s.image;
  sessions.delete(token);
  return image;
}

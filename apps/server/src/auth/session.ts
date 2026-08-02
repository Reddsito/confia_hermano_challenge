import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  discordId: string;
  username: string;
  avatar: string | null;
  /** Seconds since epoch. */
  exp: number;
}

const SESSION_DAYS = 30;

function base64url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(body: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(body).digest());
}

/**
 * A compact signed token instead of a cookie session.
 *
 * The site and the API live on different domains, so a cookie would have to be
 * SameSite=None and would drag in CSRF concerns. A bearer token in
 * localStorage, sent explicitly on each call, avoids both.
 */
export function issueSession(
  payload: Omit<SessionPayload, 'exp'>,
  secret: string,
): string {
  const full: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  };
  const body = base64url(JSON.stringify(full));
  return `${body}.${sign(body, secret)}`;
}

export function readSession(
  token: string,
  secret: string,
): SessionPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromBase64url(body).toString()) as SessionPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

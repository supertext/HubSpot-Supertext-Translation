import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Sessions are signed cookies (HMAC-SHA256): the HubSpot account and the person who logged in
 * with HubSpot, the account's session epoch, and when the session ends. Nothing secret is in
 * the cookie; the token stays in the database. Forms and API calls also carry a CSRF token
 * derived from the session.
 *
 * A session lasts SESSION_DAYS and is not extended: then the person logs in with HubSpot again,
 * which only works while they still have access to the HubSpot account. A session is only valid
 * while its epoch is the account's (`Account.sessionEpoch`): *Disconnect* deletes the account,
 * so every earlier cookie stops working, also after connecting again.
 */

export const SESSION_COOKIE = 'st_session';
export const STATE_COOKIE = 'st_oauth_state';
export const SESSION_DAYS = 7;

/** The person who logged in with HubSpot (from the token's introspection). */
export interface SessionUser {
  /** HubSpot's user ID ('' if HubSpot didn't say). */
  userId: string;
  /** Their HubSpot login (email), as HubSpot reports it. */
  user: string;
}

export interface Session extends SessionUser {
  accountId: string;
  /** The account's session epoch when the session started. */
  epoch: string;
  /** Unix seconds. */
  expires: number;
}

export class Sessions {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret) throw new Error('SESSION_SECRET or HUBSPOT_CLIENT_SECRET is required.');
    this.key = createHash('sha256').update(`supertext-hubspot-session:${secret}`).digest();
  }

  private sign(data: string): string {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }

  private verify(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const dot = value.lastIndexOf('.');
    if (dot < 1) return undefined;
    const data = value.slice(0, dot);
    const given = Buffer.from(value.slice(dot + 1));
    const expected = Buffer.from(this.sign(data));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    return data;
  }

  create(accountId: string, epoch: string, user: SessionUser, now = Date.now()): string {
    const session: Session = { accountId, epoch, userId: user.userId, user: user.user, expires: Math.floor(now / 1000) + SESSION_DAYS * 86400 };
    const data = Buffer.from(JSON.stringify(session)).toString('base64url');
    return `${data}.${this.sign(data)}`;
  }

  read(cookie: string | undefined, now = Date.now()): Session | undefined {
    const data = this.verify(cookie);
    if (!data) return undefined;
    try {
      const session = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Session;
      if (!session.accountId || !session.epoch || session.expires * 1000 < now) return undefined;
      return { ...session, userId: String(session.userId ?? ''), user: String(session.user ?? '') };
    } catch {
      return undefined;
    }
  }

  /** The CSRF token for a session cookie. */
  csrf(cookie: string): string {
    return this.sign(`csrf:${cookie}`).slice(0, 32);
  }

  checkCsrf(cookie: string | undefined, token: string | undefined): boolean {
    if (!cookie || !token) return false;
    const expected = Buffer.from(this.csrf(cookie));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** A random OAuth state and its signed cookie value. */
  state(): { state: string; cookie: string } {
    const state = randomBytes(18).toString('base64url');
    return { state, cookie: `${state}.${this.sign(`state:${state}`)}` };
  }

  checkState(cookie: string | undefined, state: string | undefined): boolean {
    if (!cookie || !state) return false;
    const [value, signature] = cookie.split('.');
    if (value !== state || !signature) return false;
    const expected = Buffer.from(this.sign(`state:${state}`));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

/** A new random session epoch for an account. */
export const newSessionEpoch = (): string => randomBytes(12).toString('base64url');

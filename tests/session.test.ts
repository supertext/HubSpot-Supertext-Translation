import { describe, expect, it } from 'vitest';
import { newSessionEpoch, SESSION_DAYS, Sessions } from '../src/auth/session.js';

describe('Sessions', () => {
  const sessions = new Sessions('secret');
  const anna = { userId: '101', user: 'anna@example.com' };

  it('reads back the account, the person and the epoch it signed', () => {
    const cookie = sessions.create('48210377', 'epoch-1', anna);
    expect(sessions.read(cookie)).toMatchObject({ accountId: '48210377', epoch: 'epoch-1', userId: '101', user: 'anna@example.com' });
  });

  it('refuses forged, foreign, epoch-less and expired cookies', () => {
    const cookie = sessions.create('48210377', 'epoch-1', anna);
    const [data] = cookie.split('.');
    const forged = Buffer.from(JSON.stringify({ accountId: 'other', epoch: 'epoch-1', expires: 9e9 })).toString('base64url');
    expect(sessions.read(`${forged}.${cookie.split('.')[1]}`)).toBeUndefined();
    expect(new Sessions('other secret').read(cookie)).toBeUndefined();
    expect(sessions.read(`${data}.x`)).toBeUndefined();
    expect(sessions.read(sessions.create('1', '', anna))).toBeUndefined();
  });

  it(`ends after ${SESSION_DAYS} days, not later`, () => {
    const start = Date.parse('2026-12-01T09:00:00Z');
    const cookie = sessions.create('1', 'e', anna, start);
    expect(sessions.read(cookie, start + (SESSION_DAYS * 86400 - 60) * 1000)).toBeDefined();
    expect(sessions.read(cookie, start + (SESSION_DAYS * 86400 + 60) * 1000)).toBeUndefined();
  });

  it('ties CSRF tokens and OAuth states to their cookie', () => {
    const cookie = sessions.create('1', 'e', anna);
    expect(sessions.checkCsrf(cookie, sessions.csrf(cookie))).toBe(true);
    expect(sessions.checkCsrf(cookie, sessions.csrf(sessions.create('2', 'e', anna)))).toBe(false);
    const { state, cookie: stateCookie } = sessions.state();
    expect(sessions.checkState(stateCookie, state)).toBe(true);
    expect(sessions.checkState(stateCookie, 'other')).toBe(false);
  });

  it('makes a new random epoch each time', () => {
    expect(newSessionEpoch()).not.toBe(newSessionEpoch());
  });
});

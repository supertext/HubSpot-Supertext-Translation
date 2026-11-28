import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../src/app.js';
import { Thumb } from '../src/views/images.js';
import { MAX_BODY_BYTES, RateLimiter } from '../src/auth/limits.js';
import { encryptionKeys } from '../src/config.js';
import { Secrets } from '../src/store/store.js';
import { MAX_RUNNING_JOBS } from '../src/translation/jobs.js';
import { setup, STANDARD_SETTINGS } from './helpers.js';

describe('security headers and image addresses', () => {
  it('sends a strict Content-Security-Policy on every page', async () => {
    const env = setup();
    const response = await env.request('/');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toBe(CONTENT_SECURITY_POLICY);
    for (const part of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      expect(csp).toContain(part);
    }
    expect(csp).not.toContain('unsafe-inline');
  });

  it('shows only HTTPS image addresses as thumbnails, anything else as text', async () => {
    const html = async (src: string) => (await Thumb({ src, label: 'Original' })).toString();
    expect(await html('https://cdn.example/a.png')).toContain('<img src="https://cdn.example/a.png"');
    for (const src of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://cdn.example/a.png', '//cdn.example/a.png']) {
      const out = await html(src);
      expect(out).not.toContain('<img');
      expect(out).not.toContain('href=');
      expect(out).toContain('<code class="image-src">');
    }
  });
});

describe('stored secrets', () => {
  it('encrypts with the current key and names it', () => {
    const secrets = new Secrets(['new-key', 'old-key']);
    const value = secrets.encrypt('refresh-token');
    expect(value.startsWith(`v2:${secrets.currentKeyId}:`)).toBe(true);
    expect(value).not.toContain('refresh-token');
    expect(secrets.decrypt(value)).toBe('refresh-token');
    expect(secrets.isCurrent(value)).toBe(true);
  });

  it('still opens values of a previous key and of the format before key IDs', () => {
    const old = new Secrets('old-key');
    const stored = old.encrypt('api-key');
    const rotated = new Secrets(['new-key', 'old-key']);
    expect(rotated.decrypt(stored)).toBe('api-key');
    expect(rotated.isCurrent(stored)).toBe(false);
    // v1: iv:tag:data without a key ID (versions before 1.5).
    const v1 = ['v1', ...stored.split(':').slice(2)].join(':');
    expect(rotated.decrypt(v1)).toBe('api-key');
  });

  it("logs, and reads as empty, a value no configured key opens", () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    try {
      const stored = new Secrets('lost-key').encrypt('token');
      expect(new Secrets('other-key').decrypt(stored)).toBe('');
      expect(String(errors[0])).toContain('APP_ENCRYPTION_KEY_PREVIOUS');
      expect(String(errors[0])).not.toContain('token');
    } finally {
      console.error = original;
    }
  });

  it('puts APP_ENCRYPTION_KEY first, then the previous keys and the client secret', () => {
    expect(encryptionKeys({ encryptionKey: 'k', previousEncryptionKeys: ['p1', 'p2'], hubspotClientSecret: 'cs' })).toEqual(['k', 'p1', 'p2', 'cs']);
    expect(encryptionKeys({ encryptionKey: '', previousEncryptionKeys: [], hubspotClientSecret: 'cs' })[0]).toBe('cs');
  });
});

describe('limits and headers', () => {
  it('sends HSTS over HTTPS', async () => {
    const env = setup();
    expect((await env.request('/')).headers.get('strict-transport-security')).toBe('max-age=31536000');
  });

  it('refuses request bodies over 1 MB, except the import', async () => {
    const env = setup();
    await env.connect();
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    const response = await env.request('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': await env.csrf() }, body: JSON.stringify({ big }) });
    expect(response.status).toBe(413);
  });

  it('allows Test connection 10 times a minute per account', async () => {
    const env = setup();
    await env.connect();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await env.api('POST', '/api/test', { apiKey: 'typed-key' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it(`runs at most ${MAX_RUNNING_JOBS} translations of an account at once`, async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    // Sent together, as several tabs could.
    const responses = await Promise.all(
      Array.from({ length: MAX_RUNNING_JOBS + 2 }, () => env.api('POST', '/api/jobs', { kind: 'site-page', itemIds: ['101'], languages: ['de-ch'] })),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBe(MAX_RUNNING_JOBS);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
    await env.settle();
    expect((await env.api('POST', '/api/jobs', { kind: 'site-page', itemIds: ['101'], languages: ['de-ch'] })).status).toBe(200);
    await env.settle();
  });

  it('counts calls per key within the window', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a'), limiter.take('b')]).toEqual([true, true, false, true]);
    now = 1001;
    expect(limiter.take('a')).toBe(true);
  });
});

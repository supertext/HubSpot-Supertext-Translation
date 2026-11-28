import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../src/app.js';
import { Thumb } from '../src/views/images.js';
import { setup } from './helpers.js';

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

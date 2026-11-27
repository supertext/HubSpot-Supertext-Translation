/**
 * Screenshots of the app's pages for the guides (docs/images), taken with
 * Playwright against the stand-in HubSpot API and the real Supertext API when
 * SUPERTEXT_API_KEY is set (CI's secret), so the guides show real translations.
 * Without a key the Supertext stand-in translates (the sample account's texts
 * from tests/standin/samples.json). Version reports always go to the stand-in.
 *
 *   npm run docs:screenshots
 *
 * Chromium: Playwright's own (npx playwright install chromium), or CHROME=/path.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Locator, type Page } from 'playwright';
import { LIVE_BASE_URL } from 'supertext-sdk/v1';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryStore } from '../../src/store/store.js';
import { createHubSpotStandin } from '../standin/hubspot.js';
import { createSupertextStandin } from '../standin/supertext.js';

const out = new URL('../../docs/images/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const listen = (fetch: (request: Request) => Response | Promise<Response>, port = 0) =>
  new Promise<string>((resolve) => {
    const server = serve({ fetch, port, hostname: '127.0.0.1' }, () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

async function main() {
  const hubspot = createHubSpotStandin();
  const supertext = createSupertextStandin();
  const hubspotUrl = await listen((request) => hubspot.handle(request));
  const supertextUrl = await listen((request) => supertext.handle(request));
  // The review service for languages with Translation review on: the same stand-in, never the live one.
  const reviewUrl = await listen((request) => supertext.handle(request));
  // CI: the real Supertext API with the secret (typed into the key field below, a password field
  // that never shows it). The review service is pointed at the API itself, so Translation review
  // languages are translated for real too, without involving the review service.
  const liveKey = process.env.SUPERTEXT_API_KEY?.trim() ?? '';
  const port = 8790;
  const appUrl = `http://127.0.0.1:${port}`;
  const app = createApp({
    config: loadConfig({
      APP_URL: appUrl,
      HUBSPOT_CLIENT_ID: 'screenshots',
      HUBSPOT_CLIENT_SECRET: 'screenshots-secret',
      HUBSPOT_APP_BASE: hubspotUrl,
      HUBSPOT_API_BASE: hubspotUrl,
      ...(liveKey ? { SUPERTEXT_REVIEW_URL: LIVE_BASE_URL } : { SUPERTEXT_API_ENDPOINT: `${supertextUrl}/v1/`, SUPERTEXT_REVIEW_URL: `${reviewUrl}/v1/` }),
      // Version reports go to the stand-in, never to the live Commando Center.
      SUPERTEXT_REPORT_URL: `${supertextUrl}/report`,
    }),
    store: new MemoryStore(),
  });
  app.use('/static/*', serveStatic({ root: new URL('../../public/', import.meta.url).pathname, rewriteRequestPath: (path) => path.replace(/^\/static/, '') }));
  await listen(app.fetch, port);

  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });
  const shot = async (name: string, target: Locator | Page = page) => {
    await target.screenshot({ path: `${out}${name}.png`, animations: 'disabled' });
    console.log(`docs/images/${name}.png`);
  };

  // Start page, then connect (the stand-in approves at once and the app opens its settings).
  await page.goto(appUrl);
  await shot('connect', page.locator('.connect'));
  await page.click('text=Connect HubSpot');
  await page.waitForURL(`${appUrl}/settings`);

  // Settings: key, languages (each dropdown preselects its suggestion; German is set to de-DE explicitly), and a connection test.
  await page.fill('input[name="apiKey"]', liveKey || 'Supertext-Auth-Key 0123456789abcdef');
  await page.selectOption('select[name="sourceLanguage"]', 'en');
  for (const code of ['de-ch', 'fr-ch', 'it-ch', 'de']) await page.check(`#t-${code}`);
  // Translation review on for Swiss German.
  await page.check('input[name="review"][value="de-ch"]');
  // The Supertext code is a searchable dropdown: type part of a name or code.
  const combo = page.locator('#targets tr:has(#t-de) .combo-input');
  await combo.click();
  await combo.fill('ger');
  await page.waitForSelector('#targets tr:has(#t-de) .combo-list:not([hidden])');
  const rowBox = (await page.locator('#targets tr:has(#t-de)').boundingBox())!;
  const listBox = (await page.locator('#targets tr:has(#t-de) .combo-list').boundingBox())!;
  await page.screenshot({
    path: `${out}settings-code-search.png`,
    clip: { x: rowBox.x - 8, y: rowBox.y - 8, width: rowBox.width + 16, height: listBox.y + listBox.height - rowBox.y + 16 },
  });
  console.log('docs/images/settings-code-search.png');
  await combo.fill('germany');
  await combo.press('Enter');
  if ((await page.inputValue('select[name="code:de"]')) !== 'de-DE') throw new Error('the dropdown did not choose de-DE');
  await page.check('input[name="translateLinks"]'); // a beta, off by default
  await page.click('button.primary');
  await page.waitForSelector('.notice.success');
  await page.click('#test-button');
  await page.waitForSelector('#test-result.ok');
  // Only the chosen languages and a few others: the full table of languages is long.
  await page.evaluate(() => {
    document.querySelectorAll('#targets tr.other').forEach((row, i) => {
      if (i > 2) (row as HTMLElement).style.display = 'none';
    });
  });
  await shot('settings', page.locator('main'));

  // Translate page: the About us page, Swiss German and French.
  await page.goto(`${appUrl}/?kind=site-page`);
  await page.check('input[name="item"][value="101"]');
  await page.uncheck('input[name="language"][value="it-ch"]');
  await page.uncheck('input[name="language"][value="de"]');
  await shot('translate-page', page.locator('#translate-form'));

  // Results after translating.
  await page.click('#translate-button');
  await page.waitForURL(/[?&]job=/, { timeout: 300_000 });
  await page.waitForSelector('.job .notice.success', { timeout: 300_000 });
  await shot('translate-results', page.locator('.job'));
  await shot('translated-state', page.locator('table.items'));

  // Updating existing versions: the warning.
  // Update existing versions is ticked by default, with its warning.
  await shot('overwrite-warning', page.locator('#translate-form'));

  // A marketing email, translated into three languages.
  await page.goto(`${appUrl}/?kind=email`);
  await page.check('input[name="item"][value="401"]');
  await page.uncheck('input[name="language"][value="de"]');
  await page.click('#translate-button');
  await page.waitForURL(/[?&]job=/, { timeout: 300_000 });
  await page.waitForSelector('.job .notice.success', { timeout: 300_000 });
  await shot('email-results', page.locator('main'));

  // The blog posts in German.
  await page.goto(`${appUrl}/?kind=blog-post&lang=de`);
  await page.check('input[name="item"][value="301"]');
  await page.uncheck('input[name="language"][value="de"]');
  await shot('translate-page-de', page.locator('#translate-form'));

  // Translation files: export the landing page as HTML for German (Switzerland), "translate" it with the
  // sample translations (as a translator would), import it.
  await page.goto(`${appUrl}/?kind=landing-page&lang=en`);
  await page.check('input[name="item"][value="201"]');
  for (const code of ['fr-ch', 'it-ch', 'de']) await page.uncheck(`input[name="language"][value="${code}"]`);
  await page.check('input[name="format"][value="html"]');
  await shot('export-section', page.locator('#export-section'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-button')]);
  const exported = readFileSync(await download.path(), 'utf8');
  const german = JSON.parse(readFileSync(new URL('../standin/samples.json', import.meta.url), 'utf8')).de as Record<string, string>;
  const translated = exported.replace(/(<div data-st-id="\d+">)([\s\S]*?)(<\/div>)/g, (all, open: string, text: string, close: string) =>
    german[text] ? open + german[text] + close : all,
  );
  const file = join(mkdtempSync(join(tmpdir(), 'supertext-')), 'hubspot-201-de-ch.html');
  writeFileSync(file, translated);
  await page.goto(`${appUrl}/import`);
  await page.setInputFiles('input[name="file"]', file);
  await shot('import-form', page.locator('#import-form'));
  await page.click('#import-form button.primary');
  await page.waitForSelector('.job');
  await shot('import-results', page.locator('.job'));

  // A knowledge base article that links to items not translated yet: its links wait (Settings → Links between translations).
  await page.goto(`${appUrl}/?kind=kb-article&lang=en`);
  await page.check('input[name="item"][value="502"]');
  await page.uncheck('input[name="language"][value="de"]'); // the knowledge base has the Swiss languages only
  await page.click('#translate-button');
  await page.waitForURL(/[?&]job=/, { timeout: 300_000 });
  await page.waitForSelector('.job .notice.success', { timeout: 300_000 });
  // Then a batch: "About us" and the contact page in one job. The links to the contact page now point to its translations.
  await page.goto(`${appUrl}/?kind=site-page&lang=en`);
  await page.check('input[name="item"][value="101"]');
  await page.check('input[name="item"][value="102"]');
  await page.uncheck('input[name="language"][value="de"]');
  await shot('translate-batch', page.locator('#translate-form'));
  await page.click('#translate-button');
  await page.waitForURL(/[?&]job=/, { timeout: 300_000 });
  await page.waitForSelector('.job .notice', { timeout: 300_000 });
  await shot('batch-results', page.locator('.job'));
  await page.goto(`${appUrl}/links`);
  await shot('links', page.locator('main'));

  // History: every translation, filtered by kind and outcome.
  await page.goto(`${appUrl}/history?lang=en`);
  await shot('history', page.locator('main'));

  // Phones: every page must fit a 390 px wide screen (wide tables scroll inside their card).
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await phone.context().addCookies(await page.context().cookies());
  for (const path of ['/?lang=en', '/?kind=email', '/import', '/links', '/history', '/settings']) {
    await phone.goto(`${appUrl}${path}`);
    const width = await phone.evaluate(() => document.documentElement.scrollWidth);
    if (width > 390) throw new Error(`${path} is ${width}px wide on a phone (390px screen)`);
  }
  await phone.click('form.settings button.primary', { trial: true });
  console.log('phone layout: all pages fit 390px');

  await browser.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

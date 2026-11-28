import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp, services } from './app.js';
import { scheduleInstallChecks } from './hubspot/installs.js';
import { encryptionKeys, loadConfig } from './config.js';
import { ensureDatabase, PostgresStore } from './store/postgres.js';
import { MemoryStore, Secrets, type Store } from './store/store.js';
import { VERSION } from './version.js';

const config = loadConfig();

async function main() {
  let store: Store;
  if (config.databaseUrl) {
    await ensureDatabase(config.databaseUrl);
    const postgres = new PostgresStore(
      config.databaseUrl,
      new Secrets(encryptionKeys(config).length ? encryptionKeys(config) : ['local-development-only']),
    );
    await postgres.migrate();
    store = postgres;
  } else {
    console.warn('Supertext: DATABASE_URL is not set; settings and jobs are kept in memory only.');
    store = new MemoryStore();
  }
  await store.failRunningJobs({ message: 'The app restarted during the translation.', code: 'interrupted' });
  if (!config.hubspotClientId || !config.hubspotClientSecret) {
    console.warn('Supertext: HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET are not set; HubSpot cannot be connected.');
  }
  if (!config.sessionSecret) {
    console.warn('Supertext: SESSION_SECRET is not set; sessions are signed with a key derived from the client secret (a new client secret logs everyone out). Set it to a long random value.');
  }
  if (config.databaseUrl && !config.encryptionKey) {
    console.warn('Supertext: APP_ENCRYPTION_KEY is not set; stored tokens and API keys are encrypted with a key derived from the client secret. Set it to a long random value: the stored secrets are re-encrypted with it on the next start.');
  }

  const app = createApp({ config, store });
  // Uninstalls in HubSpot: noticed within a day, data deleted 30 days later (hubspot/installs.ts).
  if (config.hubspotClientId && config.hubspotClientSecret) scheduleInstallChecks({ store, tokens: services({ config, store }).tokens });
  const root = new URL('../public/', import.meta.url).pathname;
  // Versioned addresses (?v=<content hash>, see views/layout.tsx) can be cached for good; others are revalidated.
  app.use('/static/*', async (c, next) => {
    await next();
    c.header('Cache-Control', c.req.query('v') ? 'public, max-age=31536000, immutable' : 'no-cache');
  });
  app.use('/static/*', serveStatic({ root, rewriteRequestPath: (path) => path.replace(/^\/static/, '') }));

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Supertext Translation for HubSpot ${VERSION} listening on port ${info.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

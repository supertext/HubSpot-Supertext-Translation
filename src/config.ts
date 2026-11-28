/** Settings from environment variables (Railway variables in production). */
export interface Config {
  port: number;
  /** Public HTTPS URL of this app; the OAuth redirect URL is APP_URL/oauth/callback. */
  appUrl: string;
  /** From the app's Auth tab in HubSpot (Development → Projects → Supertext Translation). */
  hubspotClientId: string;
  hubspotClientSecret: string;
  /** HubSpot's app host for the install (authorize) page. Points at a stand-in in tests and for screenshots. */
  hubspotAppBase: string;
  /** HubSpot's API host (OAuth tokens and content APIs). Points at a stand-in in tests and for screenshots. */
  hubspotApiBase: string;
  /** Scopes the install asks for (space-separated); must match the app's requiredScopes. */
  hubspotScopes: string;
  /** Scopes the install offers if the account has them (the knowledge base: Service Hub Professional+). */
  hubspotOptionalScopes: string;
  /** Signs session cookies; falls back to a key derived from the client secret. */
  sessionSecret: string;
  /**
   * SUPERTEXT_API_KEY: a Supertext API key on the server, for ONE HubSpot account only (the demo
   * account): SUPERTEXT_API_KEY_ACCOUNT, its HubSpot account ID (hub ID). Without it the key is
   * used for no account. Every other account enters its own key. See serverApiKey().
   */
  supertextApiKey: string;
  supertextApiKeyAccount: string;
  supertextEndpoint: string;
  /**
   * SUPERTEXT_REVIEW_URL: the review service for languages with *Translation review* on
   * (default: Supertext's review service, REVIEW_URL; '' turns review off for every language).
   */
  reviewUrl: string;
  databaseUrl: string;
  /** Key for encrypting stored tokens and API keys; falls back to a key derived from the client secret. */
  encryptionKey: string;
  /** SUPERTEXT_VERSION_REPORTS: `0` turns the version reports off for every account (see reporting.ts). */
  versionReports: string | undefined;
  /** SUPERTEXT_REPORT_URL: where version reports go ('' = Plugin Health's default, the live Commando Center). Tests point it at a stand-in. */
  reportUrl: string;
}

/**
 * Supertext's review service (the translation proxy of Supertext Localization Review): it speaks
 * the same API v1, forwards to the live Supertext API with the account's key and keeps every
 * translation, so reviewers can correct them on the website. Used for languages with
 * *Translation review* on.
 */
export const REVIEW_URL = 'https://localizationreview-production.up.railway.app/v1/';

export const DEFAULT_SCOPES = 'oauth content';
export const DEFAULT_OPTIONAL_SCOPES = 'cms.knowledge_base.articles.read cms.knowledge_base.articles.write cms.knowledge_base.articles.publish';

const trimSlash = (value: string) => value.replace(/\/+$/, '');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT) || 8080,
    appUrl: trimSlash(env.APP_URL || `http://127.0.0.1:${Number(env.PORT) || 8080}`),
    hubspotClientId: env.HUBSPOT_CLIENT_ID ?? '',
    hubspotClientSecret: env.HUBSPOT_CLIENT_SECRET ?? '',
    hubspotAppBase: trimSlash(env.HUBSPOT_APP_BASE || 'https://app.hubspot.com'),
    hubspotApiBase: trimSlash(env.HUBSPOT_API_BASE || 'https://api.hubapi.com'),
    hubspotScopes: (env.HUBSPOT_SCOPES ?? DEFAULT_SCOPES).trim(),
    hubspotOptionalScopes: (env.HUBSPOT_OPTIONAL_SCOPES ?? DEFAULT_OPTIONAL_SCOPES).trim(),
    sessionSecret: env.SESSION_SECRET ?? '',
    supertextApiKey: env.SUPERTEXT_API_KEY ?? '',
    supertextApiKeyAccount: (env.SUPERTEXT_API_KEY_ACCOUNT ?? '').trim(),
    supertextEndpoint: env.SUPERTEXT_API_ENDPOINT ?? '',
    reviewUrl: (env.SUPERTEXT_REVIEW_URL ?? REVIEW_URL).trim(),
    databaseUrl: env.DATABASE_URL ?? '',
    encryptionKey: env.APP_ENCRYPTION_KEY ?? '',
    versionReports: env.SUPERTEXT_VERSION_REPORTS,
    reportUrl: env.SUPERTEXT_REPORT_URL ?? '',
  };
}

/**
 * The server's Supertext API key for an account: SUPERTEXT_API_KEY, but only for the account
 * SUPERTEXT_API_KEY_ACCOUNT names ('' for every other account, and when that is not set), so the
 * key on the server can't be used by whoever installs the app.
 */
export function serverApiKey(config: Pick<Config, 'supertextApiKey' | 'supertextApiKeyAccount'>, accountId: string): string {
  if (!config.supertextApiKey || !config.supertextApiKeyAccount) return '';
  return config.supertextApiKeyAccount === accountId ? config.supertextApiKey : '';
}

import pg from 'pg';
import type { ReporterState } from 'supertext-plugin-health';
import type { Tokens } from '../hubspot/client.js';
import type { Kind } from '../hubspot/content.js';
import type { ErrorInfo } from '../i18n/error.js';
import type { ImageRecord } from '../translation/images.js';
import { defaultAccount, type Account, type Job, type JobQuery, type Secrets, type VersionImages, type Store, type Translation, type LinkStatus } from './store.js';

/**
 * PostgreSQL store (the shared Railway Postgres; its own database, created on
 * first start). Accounts keep the OAuth tokens and the Supertext key
 * encrypted; the other settings are JSON.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  token_expires_at BIGINT NOT NULL DEFAULT 0,
  api_key TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS translations (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  language TEXT NOT NULL,
  target_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind, source_id, language)
);
CREATE TABLE IF NOT EXISTS translation_jobs (
  id UUID PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TABLE IF EXISTS waiting_links;
CREATE TABLE IF NOT EXISTS content_links (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  language TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL,
  href TEXT,
  PRIMARY KEY (account_id, kind, item_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS content_links_target ON content_links (account_id, language, target_kind, target_id);
CREATE TABLE IF NOT EXISTS version_images (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  language TEXT NOT NULL,
  source_id TEXT NOT NULL,
  images JSONB NOT NULL,
  PRIMARY KEY (account_id, kind, item_id)
);
CREATE INDEX IF NOT EXISTS translation_jobs_account ON translation_jobs (account_id, created_at DESC);
`;

/** Creates the database named in the URL if it doesn't exist (the shared server has several). */
export async function ensureDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name || name === 'postgres') return;
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`Created database ${name}.`);
    }
  } finally {
    await admin.end();
  }
}

interface AccountRow {
  account_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | number;
  api_key: string;
  data: Partial<Account>;
}

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string, private readonly secrets: Secrets) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
    await this.reencrypt();
  }

  /** Re-encrypts tokens and API keys that aren't on the current key (after a key change, or from before key IDs). */
  async reencrypt(): Promise<number> {
    const { rows } = await this.pool.query('SELECT account_id, access_token, refresh_token, api_key FROM accounts');
    let changed = 0;
    for (const row of rows as { account_id: string; access_token: string; refresh_token: string; api_key: string }[]) {
      const fields = [row.access_token, row.refresh_token, row.api_key];
      if (fields.every((value) => this.secrets.isCurrent(value))) continue;
      const plain = fields.map((value) => this.secrets.decrypt(value));
      // A value no key opens stays as it is (it may open again once its key is configured).
      const next = fields.map((value, i) => (plain[i] || !value ? this.secrets.encrypt(plain[i]) : value));
      await this.pool.query('UPDATE accounts SET access_token = $2, refresh_token = $3, api_key = $4 WHERE account_id = $1', [row.account_id, ...next]);
      changed++;
    }
    if (changed) console.log(`Supertext: re-encrypted the stored secrets of ${changed} account(s) with key ${this.secrets.currentKeyId}.`);
    return changed;
  }

  private account(row: AccountRow): Account {
    return {
      ...defaultAccount(row.account_id),
      ...row.data,
      accountId: row.account_id,
      accessToken: this.secrets.decrypt(row.access_token),
      refreshToken: this.secrets.decrypt(row.refresh_token),
      tokenExpiresAt: Number(row.token_expires_at) || 0,
      apiKey: this.secrets.decrypt(row.api_key),
    };
  }

  async getAccount(accountId: string) {
    const { rows } = await this.pool.query('SELECT * FROM accounts WHERE account_id = $1', [accountId]);
    return rows[0] ? this.account(rows[0] as AccountRow) : undefined;
  }

  async saveAccount(account: Account) {
    // Tokens are written only by saveTokens and the reporter's state only by saveReporterState:
    // a settings save that started before a token refresh or a background report finished must
    // not put back older values.
    const { accessToken: _a, refreshToken: _r, tokenExpiresAt: _e, apiKey, reporter: _reporter, disconnectedAt: _d, ...data } = account;
    await this.pool.query(
      `INSERT INTO accounts (account_id, api_key, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (account_id) DO UPDATE SET api_key = $2,
         data = $3::jsonb || jsonb_strip_nulls(jsonb_build_object('reporter', accounts.data->'reporter', 'disconnectedAt', accounts.data->'disconnectedAt')),
         updated_at = now()`,
      [account.accountId, this.secrets.encrypt(apiKey), data],
    );
  }

  async saveTokens(accountId: string, tokens: Tokens | null) {
    await this.pool.query(
      `UPDATE accounts SET access_token = $2, refresh_token = $3, token_expires_at = $4,
         data = CASE WHEN $5::boolean THEN data - 'disconnectedAt'
                     WHEN data ? 'disconnectedAt' THEN data
                     ELSE jsonb_set(data, '{disconnectedAt}', to_jsonb($6::text), true) END,
         updated_at = now() WHERE account_id = $1`,
      [
        accountId,
        this.secrets.encrypt(tokens?.accessToken ?? ''),
        this.secrets.encrypt(tokens?.refreshToken ?? ''),
        tokens?.expiresAt ?? 0,
        tokens !== null,
        new Date().toISOString(),
      ],
    );
  }

  async accountStates() {
    const { rows } = await this.pool.query("SELECT account_id, refresh_token, data->>'disconnectedAt' AS disconnected_at FROM accounts");
    return rows.map((row) => ({
      accountId: String(row.account_id),
      connected: this.secrets.decrypt(String(row.refresh_token ?? '')) !== '',
      ...(row.disconnected_at ? { disconnectedAt: String(row.disconnected_at) } : {}),
    }));
  }

  async saveReporterState(accountId: string, state: ReporterState) {
    await this.pool.query(
      `UPDATE accounts SET data = jsonb_set(data, '{reporter}', $2::jsonb, true) WHERE account_id = $1`,
      [accountId, JSON.stringify(state)],
    );
  }

  async deleteAccount(accountId: string) {
    for (const table of ['accounts', 'translations', 'translation_jobs', 'content_links', 'version_images']) {
      await this.pool.query(`DELETE FROM ${table} WHERE account_id = $1`, [accountId]);
    }
  }

  async translations(accountId: string, kind: Kind) {
    const { rows } = await this.pool.query(
      'SELECT source_id, language, target_id FROM translations WHERE account_id = $1 AND kind = $2',
      [accountId, kind],
    );
    const result = new Map<string, Record<string, string>>();
    for (const row of rows) {
      result.set(row.source_id, { ...(result.get(row.source_id) ?? {}), [row.language]: row.target_id });
    }
    return result;
  }

  async saveTranslation(accountId: string, translation: Translation) {
    await this.pool.query(
      `INSERT INTO translations (account_id, kind, source_id, language, target_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, kind, source_id, language) DO UPDATE SET target_id = $5, updated_at = $6`,
      [accountId, translation.kind, translation.sourceId, translation.language, translation.targetId, translation.updatedAt],
    );
  }

  async saveLinks(accountId: string, kind: Kind, itemId: string, language: string, links: { targetKind: Kind; targetId: string; status: 'translated' | 'waiting'; href?: string }[]) {
    await this.pool.query("DELETE FROM content_links WHERE account_id = $1 AND kind = $2 AND item_id = $3 AND status <> 'kept'", [accountId, kind, itemId]);
    for (const link of links) {
      await this.pool.query(
        'INSERT INTO content_links (account_id, kind, item_id, language, target_kind, target_id, status, href) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING',
        [accountId, kind, itemId, language, link.targetKind, link.targetId, link.status, link.href ?? null],
      );
    }
  }

  async saveImages(accountId: string, record: VersionImages) {
    await this.pool.query(
      `INSERT INTO version_images (account_id, kind, item_id, language, source_id, images) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, kind, item_id) DO UPDATE SET language = $4, source_id = $5, images = $6`,
      [accountId, record.kind, record.itemId, record.language, record.sourceId, JSON.stringify(record.images)],
    );
  }

  async imagesOf(accountId: string, kind: Kind, itemId: string) {
    const { rows } = await this.pool.query('SELECT images FROM version_images WHERE account_id = $1 AND kind = $2 AND item_id = $3', [accountId, kind, itemId]);
    return rows[0] ? (rows[0].images as ImageRecord[]) : undefined;
  }

  async allImages(accountId: string) {
    const { rows } = await this.pool.query(
      'SELECT kind, item_id, language, source_id, images FROM version_images WHERE account_id = $1 ORDER BY language, item_id',
      [accountId],
    );
    return rows.map((row) => ({
      kind: row.kind as Kind,
      itemId: String(row.item_id),
      language: String(row.language),
      sourceId: String(row.source_id),
      images: row.images as ImageRecord[],
    }));
  }

  async allLinks(accountId: string) {
    const { rows } = await this.pool.query(
      'SELECT kind, item_id, language, target_kind, target_id, status, href FROM content_links WHERE account_id = $1 ORDER BY language, item_id, target_id',
      [accountId],
    );
    return rows.map((row) => ({
      kind: row.kind as Kind,
      itemId: String(row.item_id),
      language: String(row.language),
      targetKind: row.target_kind as Kind,
      targetId: String(row.target_id),
      status: row.status as LinkStatus,
      href: row.href ? String(row.href) : undefined,
    }));
  }

  async waitingFor(accountId: string, language: string, targetKind: Kind, targetId: string) {
    const { rows } = await this.pool.query(
      "SELECT kind, item_id FROM content_links WHERE account_id = $1 AND language = $2 AND target_kind = $3 AND target_id = $4 AND status = 'waiting'",
      [accountId, language, targetKind, targetId],
    );
    return rows.map((row) => ({ kind: row.kind as Kind, itemId: String(row.item_id) }));
  }

  async setKept(accountId: string, kind: Kind, itemId: string, targetKind: Kind, targetId: string, kept: boolean) {
    await this.pool.query(
      'UPDATE content_links SET status = $6 WHERE account_id = $1 AND kind = $2 AND item_id = $3 AND target_kind = $4 AND target_id = $5',
      [accountId, kind, itemId, targetKind, targetId, kept ? 'kept' : 'waiting'],
    );
  }

  async keptLinks(accountId: string, kind: Kind, itemId: string) {
    const { rows } = await this.pool.query(
      "SELECT target_kind, target_id FROM content_links WHERE account_id = $1 AND kind = $2 AND item_id = $3 AND status = 'kept'",
      [accountId, kind, itemId],
    );
    return rows.map((row) => `${String(row.target_kind)}:${String(row.target_id)}`);
  }


  async saveJob(job: Job) {
    await this.pool.query(
      `INSERT INTO translation_jobs (id, account_id, status, data, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET status = $3, data = $4`,
      [job.id, job.accountId, job.status, job, job.createdAt],
    );
  }

  async getJob(accountId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const { rows } = await this.pool.query('SELECT data FROM translation_jobs WHERE id = $1 AND account_id = $2', [
      id,
      accountId,
    ]);
    return rows[0]?.data as Job | undefined;
  }

  async recentJobs(accountId: string, limit: number) {
    const { rows } = await this.pool.query(
      'SELECT data FROM translation_jobs WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2',
      [accountId, limit],
    );
    return rows.map((row) => row.data as Job);
  }

  async findJobs(accountId: string, query: JobQuery) {
    const where = ['account_id = $1'];
    const params: unknown[] = [accountId];
    if (query.kind) {
      params.push(query.kind);
      where.push(`data->>'kind' = $${params.length}`);
    }
    if (query.outcome === 'running') where.push(`status = 'running'`);
    // Stopped, or a language that failed (items is a JSON array of results).
    if (query.outcome === 'problems') where.push(`(status = 'failed' OR data->'items' @> '[{"state":"failed"}]'::jsonb)`);
    const condition = where.join(' AND ');
    const total = await this.pool.query(`SELECT count(*)::int AS n FROM translation_jobs WHERE ${condition}`, params);
    const { rows } = await this.pool.query(
      `SELECT data FROM translation_jobs WHERE ${condition} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, query.offset],
    );
    return { jobs: rows.map((row) => row.data as Job), total: Number(total.rows[0]?.n ?? 0) };
  }

  async failRunningJobs(error: ErrorInfo) {
    const { rows } = await this.pool.query("SELECT data FROM translation_jobs WHERE status = 'running'");
    for (const row of rows) {
      const job = row.data as Job;
      await this.saveJob({ ...job, status: 'failed', error, finishedAt: new Date().toISOString() });
    }
  }
}

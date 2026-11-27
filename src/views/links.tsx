import { editorUrl } from '../hubspot/content.js';
import type { Account } from '../store/store.js';
import { languageName } from '../translation/languages.js';
import { Layout, Notice, type PageContext } from './layout.js';

export interface WaitingRow {
  articleId: string;
  language: string;
  targetId: string;
  /** The translation that links to the original (undefined: no longer in HubSpot). */
  article?: { title: string; url: string };
  /** The original it links to. */
  target?: { title: string; url: string };
}

export interface LinksPageProps {
  ctx: PageContext;
  account: Account;
  appBase: string;
  rows: WaitingRow[];
  /** After "Update links now": translations whose links changed / that wait no more. */
  updated?: number;
  removed?: boolean;
}

/**
 * Links waiting for a translation (Settings → Translation): translations whose links still point
 * to an original that has no version in their language yet. Fixed automatically when the app
 * translates that original; "Update links now" checks them all again (versions made by hand
 * too), "Stop waiting" leaves a link on the original.
 */
export function LinksPage(props: LinksPageProps) {
  const { ctx, account, rows } = props;
  const { t } = ctx;
  const heading = t.t('links.heading');
  return (
    <Layout ctx={ctx} title={heading}>
      <h1>{heading}</h1>
      <p class="intro">{t.t('links.intro')}</p>
      {!account.translateLinks && <Notice tone="info">{t.t('links.off')}</Notice>}
      {props.updated !== undefined && <Notice tone="success">{t.tn('links.updated', props.updated)}</Notice>}
      {props.removed && <Notice tone="success">{t.t('links.removed')}</Notice>}

      <section class="card">
        {rows.length === 0 ? (
          <p class="muted">{t.t('links.empty')}</p>
        ) : (
          <div class="table-scroll">
            <table class="links">
              <thead>
                <tr>
                  <th>{t.t('links.language')}</th>
                  <th>{t.t('links.translation')}</th>
                  <th>{t.t('links.waitsFor')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr>
                    <td class="lang">{languageName(row.language, t.locale)}</td>
                    <td class="title">
                      {row.article ? (
                        <a href={editorUrl('kb-article', account.accountId, row.articleId, props.appBase)} target="_blank" rel="noopener">
                          {row.article.title}
                        </a>
                      ) : (
                        <span class="muted">{t.t('links.gone', { id: row.articleId })}</span>
                      )}
                    </td>
                    <td>
                      {row.target ? (
                        <a href={editorUrl('kb-article', account.accountId, row.targetId, props.appBase)} target="_blank" rel="noopener">
                          {row.target.title}
                        </a>
                      ) : (
                        <span class="muted">{t.t('links.gone', { id: row.targetId })}</span>
                      )}
                    </td>
                    <td class="link">
                      <form method="post" action="/links/remove">
                        <input type="hidden" name="csrf" value={ctx.csrf} />
                        <input type="hidden" name="articleId" value={row.articleId} />
                        <input type="hidden" name="targetId" value={row.targetId} />
                        <button type="submit" class="small">
                          {t.t('links.remove')}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form method="post" action="/links/update" class="actions">
          <input type="hidden" name="csrf" value={ctx.csrf} />
          <button type="submit" class="primary" disabled={!account.translateLinks}>
            {t.t('links.update')}
          </button>
        </form>
        <p class="help">{t.t('links.updateHelp')}</p>
      </section>
      <p>
        <a href="/settings">{t.t('links.back')}</a>
      </p>
    </Layout>
  );
}

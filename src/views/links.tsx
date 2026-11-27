import { editorUrl, type Kind } from '../hubspot/content.js';
import type { MessageKey } from '../i18n/index.js';
import type { Account, LinkStatus } from '../store/store.js';
import { languageName } from '../translation/languages.js';
import { LinksImagesTabs } from './images.js';
import { appUrl, Layout, Notice, type PageContext } from './layout.js';

export interface LinkRow {
  kind: Kind;
  itemId: string;
  language: string;
  targetKind: Kind;
  targetId: string;
  status: LinkStatus;
  /** The translation the link is in (undefined: no longer in HubSpot). */
  item?: { title: string };
  /** The original it links to. */
  target?: { title: string };
}

export type LinkFilter = 'all' | LinkStatus;
export const LINK_FILTERS: readonly LinkFilter[] = ['all', 'waiting', 'translated', 'kept'];

export interface LinksPageProps {
  ctx: PageContext;
  account: Account;
  appBase: string;
  /** The rows of this page of the list (filtered). */
  rows: LinkRow[];
  filter: LinkFilter;
  /** Links per status, for the filter tabs. */
  counts: Record<LinkFilter, number>;
  page: number;
  pages: number;
  /** After "Update links now": translations whose links changed. */
  updated?: number;
  changed?: boolean;
  /** Images recorded in translations (the Images tab). */
  imageCount: number;
}

/**
 * Links between translations (Settings → Translation): every link in a translation the app wrote
 * to another page, post or article, and where it points. Waiting links are fixed when the app
 * translates the item they point to; "Update links now" checks the waiting ones again (versions
 * made by hand too); "Keep the original link" leaves one on the original for good.
 */
export function LinksPage(props: LinksPageProps) {
  const { ctx, account, rows } = props;
  const { t } = ctx;
  const heading = t.t('links.heading');
  const kindName = (kind: Kind) => t.t(`links.kind.${kind}` as MessageKey);
  const open = (kind: Kind, id: string, title: string) => (
    <a href={editorUrl(kind, account.accountId, id, props.appBase)} target="_blank" rel="noopener">
      {title}
    </a>
  );
  return (
    <Layout ctx={ctx} title={heading}>
      <LinksImagesTabs t={t} active="links" links={props.counts.all} images={props.imageCount} />
      <h1>
        {heading} <span class="badge beta">{t.t('beta')}</span>
      </h1>
      <p class="intro">{t.t('links.intro')}</p>
      {!account.translateLinks && <Notice tone="info">{t.t('links.off')}</Notice>}
      {props.updated !== undefined && <Notice tone="success">{t.tn('links.updated', props.updated)}</Notice>}
      {props.changed && <Notice tone="success">{t.t('links.changed')}</Notice>}

      <section class="card">
        <nav class="kinds" aria-label={t.t('links.filter')}>
          {LINK_FILTERS.map((filter) => (
            <a href={appUrl('/links', filter === 'all' ? {} : { status: filter })} class={filter === props.filter ? 'active' : ''}>
              {t.t(`links.filter.${filter}` as MessageKey)} ({props.counts[filter]})
            </a>
          ))}
        </nav>
        {rows.length === 0 ? (
          <p class="muted">{t.t(props.counts.all === 0 ? 'links.none' : 'links.noneHere')}</p>
        ) : (
          <div class="table-scroll">
            <table class="links">
              <thead>
                <tr>
                  <th>{t.t('links.language')}</th>
                  <th>{t.t('links.translation')}</th>
                  <th>{t.t('links.linksTo')}</th>
                  <th>{t.t('links.status')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr>
                    <td class="lang">{languageName(row.language, t.locale)}</td>
                    <td class="title">
                      {row.item ? open(row.kind, row.itemId, row.item.title) : <span class="muted">{t.t('links.gone', { id: row.itemId })}</span>}
                      <span class="sub">{kindName(row.kind)}</span>
                    </td>
                    <td>
                      {row.target ? open(row.targetKind, row.targetId, row.target.title) : <span class="muted">{t.t('links.gone', { id: row.targetId })}</span>}
                      <span class="sub">{kindName(row.targetKind)}</span>
                    </td>
                    <td>
                      <span class={`badge link-${row.status}`}>{t.t(`links.status.${row.status}` as MessageKey)}</span>
                    </td>
                    <td class="link">
                      {row.status !== 'translated' && (
                        <form method="post" action="/links/keep">
                          <input type="hidden" name="csrf" value={ctx.csrf} />
                          <input type="hidden" name="kind" value={row.kind} />
                          <input type="hidden" name="itemId" value={row.itemId} />
                          <input type="hidden" name="targetKind" value={row.targetKind} />
                          <input type="hidden" name="targetId" value={row.targetId} />
                          <input type="hidden" name="keep" value={row.status === 'waiting' ? '1' : '0'} />
                          <input type="hidden" name="status" value={props.filter} />
                          <button type="submit" class="small">
                            {t.t(row.status === 'waiting' ? 'links.keep' : 'links.unkeep')}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {props.pages > 1 && (
          <div class="pager">
            <span class="muted">{t.t('links.page', { page: String(props.page), pages: String(props.pages) })}</span>
            <span class="spacer"></span>
            {props.page > 1 && (
              <a href={appUrl('/links', { ...(props.filter === 'all' ? {} : { status: props.filter }), page: String(props.page - 1) })}>
                {t.t('links.previous')}
              </a>
            )}
            {props.page < props.pages && (
              <a href={appUrl('/links', { ...(props.filter === 'all' ? {} : { status: props.filter }), page: String(props.page + 1) })}>
                {t.t('links.next')}
              </a>
            )}
          </div>
        )}
        <form method="post" action="/links/update" class="actions">
          <input type="hidden" name="csrf" value={ctx.csrf} />
          {/* The tooltip sits on a wrapper too, so it shows while the button is disabled. */}
          <span title={t.t('links.updateTooltip')}>
            <button type="submit" class="primary" title={t.t('links.updateTooltip')} disabled={!account.translateLinks || props.counts.waiting === 0}>
              {t.t('links.update')}
            </button>
          </span>
        </form>
        <p class="help">{t.t('links.updateHelp')}</p>
      </section>
      <p>
        <a href="/settings">{t.t('links.back')}</a>
      </p>
    </Layout>
  );
}

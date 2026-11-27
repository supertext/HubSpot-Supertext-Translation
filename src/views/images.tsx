import { editorUrl, type Kind } from '../hubspot/content.js';
import type { MessageKey, Translator } from '../i18n/index.js';
import type { Account } from '../store/store.js';
import type { ImageReason, ImageStatus } from '../translation/images.js';
import { languageName } from '../translation/languages.js';
import { appUrl, Layout, Notice, type PageContext } from './layout.js';

export type ImageFilter = 'all' | ImageStatus;
export const IMAGE_FILTERS: readonly ImageFilter[] = ['all', 'check', 'own', 'same'];

export interface ImageRow {
  kind: Kind;
  /** The version. */
  itemId: string;
  language: string;
  slot: string;
  originalSrc: string;
  src: string;
  status: ImageStatus;
  reason?: ImageReason;
  /** The version's title (undefined: no longer in HubSpot or not read). */
  title?: string;
}

/** The tabs on the Links/Images page. */
export function LinksImagesTabs(props: { t: Translator; active: 'links' | 'images'; links: number; images: number }) {
  const { t } = props;
  return (
    <nav class="subtabs" aria-label={t.t('nav.links')}>
      <a href="/links" class={props.active === 'links' ? 'active' : ''}>
        {t.t('links.tabLinks')} ({props.links})
      </a>
      <a href="/images" class={props.active === 'images' ? 'active' : ''}>
        {t.t('links.tabImages')} ({props.images})
      </a>
    </nav>
  );
}

/** An image as a small thumbnail opening the full image (only http(s) addresses). */
function Thumb(props: { src: string; label: string }) {
  if (!/^https?:\/\//i.test(props.src)) return <code class="image-src">{props.src}</code>;
  return (
    <a href={props.src} target="_blank" rel="noopener" class="thumb" title={props.src}>
      <img src={props.src} alt={props.label} loading="lazy" width="96" height="64" />
    </a>
  );
}

export interface ImagesPageProps {
  ctx: PageContext;
  account: Account;
  appBase: string;
  rows: ImageRow[];
  filter: ImageFilter;
  counts: Record<ImageFilter, number>;
  /** For the tabs. */
  linkCount: number;
  page: number;
  pages: number;
  checked?: boolean;
}

/**
 * Images in the translations the app wrote: per image, the original's and the translation's,
 * and whether the translation has the original's, its own (kept on updates), or one to check.
 */
export function ImagesPage(props: ImagesPageProps) {
  const { ctx, account, rows } = props;
  const { t } = ctx;
  const heading = t.t('images.heading');
  const url = (change: { filter?: ImageFilter; page?: number }) => {
    const filter = change.filter ?? props.filter;
    return appUrl('/images', { status: filter === 'all' ? undefined : filter, page: change.page && change.page > 1 ? change.page : undefined });
  };
  return (
    <Layout ctx={ctx} title={heading}>
      <LinksImagesTabs t={t} active="images" links={props.linkCount} images={props.counts.all} />
      <h1>{heading}</h1>
      <p class="intro">{t.t('images.intro')}</p>
      {props.checked && <Notice tone="success">{t.t('images.checked')}</Notice>}
      <section class="card">
        <nav class="kinds" aria-label={t.t('images.filter')}>
          {IMAGE_FILTERS.map((filter) => (
            <a href={url({ filter, page: 1 })} class={filter === props.filter ? 'active' : ''}>
              {t.t(`images.filter.${filter}` as MessageKey)} ({props.counts[filter]})
            </a>
          ))}
        </nav>
        {rows.length === 0 ? (
          <p class="muted">{t.t(props.counts.all === 0 ? 'images.none' : 'images.noneHere')}</p>
        ) : (
          <div class="table-scroll">
            <table class="images">
              <thead>
                <tr>
                  <th>{t.t('links.language')}</th>
                  <th>{t.t('images.item')}</th>
                  <th>{t.t('images.originalImage')}</th>
                  <th>{t.t('images.translationImage')}</th>
                  <th>{t.t('images.statusColumn')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr>
                    <td class="lang">{languageName(row.language, t.locale)}</td>
                    <td class="title">
                      {row.title ? (
                        <a href={editorUrl(row.kind, account.accountId, row.itemId, props.appBase)} target="_blank" rel="noopener">
                          {row.title}
                        </a>
                      ) : (
                        <span class="muted">{t.t('links.gone', { id: row.itemId })}</span>
                      )}
                      <span class="sub">{t.t(`links.kind.${row.kind}` as MessageKey)}</span>
                    </td>
                    <td>
                      <Thumb src={row.originalSrc} label={t.t('images.original')} />
                    </td>
                    <td>
                      <Thumb src={row.src} label={t.t('images.inTranslation')} />
                    </td>
                    <td>
                      <span class={`badge image-${row.status}`}>{t.t(`images.status.${row.status}` as MessageKey)}</span>
                      {row.reason && <span class="sub">{t.t(`images.reason.${row.reason}` as MessageKey)}</span>}
                    </td>
                    <td class="link">
                      {row.status === 'check' && (
                        <form method="post" action="/images/checked">
                          <input type="hidden" name="csrf" value={ctx.csrf} />
                          <input type="hidden" name="kind" value={row.kind} />
                          <input type="hidden" name="itemId" value={row.itemId} />
                          <input type="hidden" name="slot" value={row.slot} />
                          <input type="hidden" name="status" value={props.filter} />
                          <button type="submit" class="small" title={t.t('images.markCheckedHelp')}>
                            {t.t('images.markChecked')}
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
            {props.page > 1 && <a href={url({ page: props.page - 1 })}>{t.t('links.previous')}</a>}
            {props.page < props.pages && <a href={url({ page: props.page + 1 })}>{t.t('links.next')}</a>}
          </div>
        )}
        <p class="help">{t.t('images.help')}</p>
      </section>
    </Layout>
  );
}

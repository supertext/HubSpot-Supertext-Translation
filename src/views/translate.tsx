import { editorUrl, type Kind } from '../hubspot/content.js';
import type { ErrorInfo } from '../i18n/error.js';
import type { MessageKey } from '../i18n/index.js';
import type { Account, Job } from '../store/store.js';
import { ITEM_FILTERS, type CatalogRow, type ItemFilter } from '../translation/catalog.js';
import { languageName, resolvedTarget } from '../translation/languages.js';
import { History, JobPanel } from './job.js';
import { ApiKeyHelp, appUrl, Layout, Notice, splitTemplate, type PageContext } from './layout.js';

export type ItemRow = CatalogRow;

/** One page of the list (searched and filtered). */
export interface ItemList {
  rows: ItemRow[];
  /** Items matching the search and filter. */
  matching: number;
  /** All translatable items loaded. */
  total: number;
  /** Items per filter (with the search). */
  counts: Record<ItemFilter, number>;
  /** False: HubSpot has more than the list loads (the most recently updated ones are listed). */
  complete: boolean;
  page: number;
  pages: number;
}

export interface TranslatePageProps {
  ctx: PageContext;
  account: Account;
  hasKey: boolean;
  /** The kinds offered (the knowledge base only with its scopes). */
  kinds: readonly Kind[];
  kind: Kind;
  list?: ItemList;
  /** Search text. */
  query: string;
  filter: ItemFilter;
  /** Most items one job translates. */
  maxBatch: number;
  /** Most items the list loads. */
  maxListed: number;
  /** Items checked (the last job's). */
  selected: string[];
  job?: Job;
  history: Job[];
  error?: ErrorInfo;
  /** The knowledge base tab is open but the account didn't grant its scopes. */
  kbMissing?: boolean;
  appBase: string;
}

export function TranslatePage(props: TranslatePageProps) {
  const { ctx, account, list, kind } = props;
  const rows = list?.rows;
  const { t } = ctx;
  const heading = t.t('translate.heading');
  const targets = account.targets;
  const selected = new Set(props.selected);
  /** This list with other search, filter or page (the kind stays). */
  const listUrl = (change: { q?: string; show?: ItemFilter; page?: number; refresh?: boolean }) => {
    const q = change.q ?? props.query;
    const show = change.show ?? props.filter;
    return appUrl('/', {
      kind,
      ...(q ? { q } : {}),
      ...(show !== 'all' ? { show } : {}),
      ...(change.page && change.page > 1 ? { page: String(change.page) } : {}),
      ...(change.refresh ? { refresh: '1' } : {}),
    });
  };

  return (
    <Layout ctx={ctx} title={heading}>
      <h1>{heading}</h1>
      <p class="intro">{t.t('translate.intro')}</p>

      {!props.hasKey && <NoKey ctx={ctx} />}
      {targets.length === 0 && <NoLanguages ctx={ctx} />}

      {targets.length > 0 && <form id="search-form" method="get" action="/" hidden></form>}
      {targets.length > 0 && (
        <form id="translate-form" class="card" data-kind={kind} data-max={String(props.maxBatch)}>
          <h2>{t.t('translate.step1')}</h2>
          <nav class="kinds" aria-label={t.t('translate.step1')}>
            {props.kinds.map((k) => (
              <a href={appUrl('/', { kind: k })} class={k === kind ? 'active' : ''}>
                {t.t(`kind.${k}` as MessageKey)}
              </a>
            ))}
          </nav>
          {props.kbMissing && <Notice tone="info">{t.t('translate.kbMissing')}</Notice>}
          {props.error && <Notice tone="error">{t.error(props.error)}</Notice>}
          {list && (list.total > 0 || props.query) && (
            <div class="list-tools">
              <div class="search">
                <input type="hidden" name="kind" value={kind} form="search-form" />
                {props.filter !== 'all' && <input type="hidden" name="show" value={props.filter} form="search-form" />}
                <label for="search" class="visually-hidden">
                  {t.t('translate.search')}
                </label>
                <input type="search" id="search" name="q" value={props.query} placeholder={t.t('translate.search')} form="search-form" />
                <button type="submit" form="search-form">
                  {t.t('translate.searchButton')}
                </button>
                {props.query && <a href={listUrl({ q: '' })}>{t.t('translate.clearSearch')}</a>}
              </div>
              <nav class="filters" aria-label={t.t('translate.filter')}>
                {ITEM_FILTERS.map((filter) => (
                  <a href={listUrl({ show: filter })} class={filter === props.filter ? 'active' : ''}>
                    {t.t(`translate.filter.${filter}` as MessageKey)} ({list.counts[filter]})
                  </a>
                ))}
              </nav>
            </div>
          )}
          {list && !list.complete && <p class="help">{t.t('translate.limited', { max: props.maxListed.toLocaleString(t.locale) })}</p>}
          {rows && rows.length === 0 && (
            <p class="muted">{t.t(list && list.total > 0 ? 'translate.noMatch' : 'translate.empty')}</p>
          )}
          {rows && rows.length > 0 && list && (
            <>
              <div class="table-scroll">
              <table class="items">
                <thead>
                  <tr>
                    <th class="check">
                      <input type="checkbox" id="select-all" title={t.t('translate.selectAll')} aria-label={t.t('translate.selectAll')} />
                    </th>
                    <th>{t.t('translate.name')}</th>
                    <th>{t.t('translate.language')}</th>
                    {targets.map((code) => (
                      <th>{languageName(code, t.locale)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, versions }) => (
                    <tr>
                      <td class="check">
                        <input type="checkbox" name="item" value={item.id} id={`i-${item.id}`} checked={selected.has(item.id)} />
                      </td>
                      <td class="title">
                        <label for={`i-${item.id}`}>{item.name}</label>
                        <span class="sub">
                          <span class={`badge state-${item.state}`}>{t.t(`state.${item.state}` as MessageKey)}</span>
                        </span>
                      </td>
                      <td class="lang">{item.language || '–'}</td>
                      {targets.map((code) => {
                        const id = versions[code];
                        if (!id) return <td><span class="badge none">{t.t('version.none')}</span></td>;
                        return (
                          <td>
                            <a class="badge done" href={editorUrl(kind, account.accountId, id, props.appBase)} target="_blank" rel="noopener">
                              {t.t('version.exists')}
                            </a>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div class="pager">
                <span
                  id="selection-count"
                  class="muted"
                  role="status"
                  data-one={t.t('translate.selected.one')}
                  data-other={t.t('translate.selected.other')}
                  data-too-many={t.t('translate.tooMany', { max: String(props.maxBatch) })}
                ></span>
                <span class="spacer"></span>
                {list.pages > 1 && (
                  <span class="muted">{t.t('translate.page', { page: String(list.page), pages: String(list.pages), count: String(list.matching) })}</span>
                )}
                {list.page > 1 && <a href={listUrl({ page: list.page - 1 })}>{t.t('translate.previousPage')}</a>}
                {list.page < list.pages && <a href={listUrl({ page: list.page + 1 })}>{t.t('translate.nextPage')}</a>}
                <a href={listUrl({ page: list.page, refresh: true })} title={t.t('translate.reloadHelp')}>
                  {t.t('translate.reload')}
                </a>
              </div>
            </>
          )}

          {rows && rows.length > 0 && (
            <>
              <h2>{t.t('translate.step2')}</h2>
              <p class="muted">
                {account.sourceLanguage
                  ? t.t('translate.from', { language: languageName(account.sourceLanguage, t.locale) })
                  : t.t('translate.fromAuto')}
              </p>
              <div class="languages">
                {targets.map((code) => (
                  <label class="language">
                    <input type="checkbox" name="language" value={code} checked />
                    <span>{languageName(code, t.locale)}</span>
                    {resolvedTarget(code, account.languageCodes) ? (
                      <code>{resolvedTarget(code, account.languageCodes)}</code>
                    ) : (
                      <span class="warning-text">{t.t('translate.notMapped')}</span>
                    )}
                  </label>
                ))}
              </div>

              <label class="inline overwrite">
                <input type="checkbox" id="overwrite" name="overwrite" checked />
                {t.t('translate.overwrite')}
              </label>
              <p class="help" id="overwrite-hint" hidden>
                {t.t('translate.overwriteHint')}
              </p>
              <div id="overwrite-warning" class="notice warning">
                {t.t('translate.overwriteWarning')}
              </div>

              <div class="actions">
                <button
                  type="submit"
                  class="primary"
                  id="translate-button"
                  disabled={!props.hasKey}
                  data-label={t.t('translate.submit')}
                  data-label-one={t.t('translate.submitCount.one')}
                  data-label-other={t.t('translate.submitCount.other')}
                  data-batch-one={t.t('translate.submitBatch.one')}
                  data-batch-other={t.t('translate.submitBatch.other')}
                  data-starting={t.t('translate.starting')}
                  data-select={t.t('translate.selectSomething')}
                >
                  {t.t('translate.submit')}
                </button>
                <span id="form-message" class="muted" role="status"></span>
              </div>

              <div id="export-section">
              <h2>{t.t('export.heading')}</h2>
              <p class="muted">{t.t('export.intro')}</p>
              <fieldset class="formats">
                <legend>{t.t('export.format')}</legend>
                <label class="inline">
                  <input type="radio" name="format" value="xliff" checked />
                  {t.t('export.xliff')}
                </label>
                <label class="inline">
                  <input type="radio" name="format" value="html" />
                  {t.t('export.html')}
                </label>
              </fieldset>
              <div class="actions">
                <button
                  type="button"
                  id="export-button"
                  data-select={t.t('translate.selectSomething')}
                  data-one={t.t('export.oneLanguage')}
                  data-one-item={t.t('export.oneItem')}
                >
                  {t.t('export.download')}
                </button>
                <span id="export-message" class="muted" role="status"></span>
              </div>
              </div>
            </>
          )}
        </form>
      )}

      <section id="job-panel" data-job={props.job?.status === 'running' ? props.job.id : undefined}>
        {props.job && <JobPanel t={t} job={props.job} portalId={account.accountId} appBase={props.appBase} />}
      </section>
      {(props.history.length > 0 || !props.job) && <History t={t} jobs={props.history} />}
    </Layout>
  );
}

function NoKey(props: { ctx: PageContext }) {
  const { t } = props.ctx;
  const [before, after] = splitTemplate(t.t('translate.noKey.text'), ['{settings}']);
  return (
    <Notice tone="warning">
      <strong>{t.t('translate.noKey.heading')}</strong>
      <p>
        {before}
        <a href="/settings">{t.t('translate.noKey.settings')}</a>
        {after}
      </p>
      <ApiKeyHelp t={t} />
    </Notice>
  );
}

function NoLanguages(props: { ctx: PageContext }) {
  const { t } = props.ctx;
  const [before, after] = splitTemplate(t.t('translate.noLanguages.text'), ['{settings}']);
  return (
    <Notice tone="info">
      <strong>{t.t('translate.noLanguages.heading')}</strong>
      <p>
        {before}
        <a href="/settings">{t.t('translate.noKey.settings')}</a>
        {after}
      </p>
    </Notice>
  );
}

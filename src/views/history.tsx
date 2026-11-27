import type { Kind } from '../hubspot/content.js';
import type { MessageKey } from '../i18n/index.js';
import type { Account, Job } from '../store/store.js';
import { JobPanel, JobRows } from './job.js';
import { appUrl, Layout, type PageContext } from './layout.js';

export type HistoryOutcome = 'all' | 'problems' | 'running';
export const HISTORY_OUTCOMES: readonly HistoryOutcome[] = ['all', 'problems', 'running'];

export interface HistoryPageProps {
  ctx: PageContext;
  /** The kinds offered as filters. */
  kinds: readonly Kind[];
  kind?: Kind;
  outcome: HistoryOutcome;
  jobs: Job[];
  /** Jobs matching the filters. */
  total: number;
  page: number;
  pages: number;
}

/** All translations of the account (History tab): newest first, 50 per page, filtered by kind and outcome. */
export function HistoryPage(props: HistoryPageProps) {
  const { ctx } = props;
  const { t } = ctx;
  const heading = t.t('history.pageHeading');
  const url = (change: { kind?: Kind | ''; outcome?: HistoryOutcome; page?: number }) => {
    const kind = change.kind === undefined ? props.kind : change.kind || undefined;
    const outcome = change.outcome ?? props.outcome;
    return appUrl('/history', { kind, outcome: outcome === 'all' ? undefined : outcome, page: change.page && change.page > 1 ? change.page : undefined });
  };
  return (
    <Layout ctx={ctx} title={heading}>
      <h1>{heading}</h1>
      <p class="intro">{t.t('history.intro')}</p>
      <section class="card">
        <nav class="kinds" aria-label={t.t('history.kindFilter')}>
          <a href={url({ kind: '', page: 1 })} class={props.kind ? '' : 'active'}>
            {t.t('history.allKinds')}
          </a>
          {props.kinds.map((kind) => (
            <a href={url({ kind, page: 1 })} class={kind === props.kind ? 'active' : ''}>
              {t.t(`kind.${kind}` as MessageKey)}
            </a>
          ))}
        </nav>
        <nav class="filters" aria-label={t.t('history.outcomeFilter')}>
          {HISTORY_OUTCOMES.map((outcome) => (
            <a href={url({ outcome, page: 1 })} class={outcome === props.outcome ? 'active' : ''}>
              {t.t(`history.outcome.${outcome}` as MessageKey)}
            </a>
          ))}
        </nav>
        {props.jobs.length === 0 ? (
          <p class="muted">{t.t('history.none')}</p>
        ) : (
          <div class="table-scroll">
            <JobRows t={t} jobs={props.jobs} />
          </div>
        )}
        <div class="pager">
          <span class="muted">{t.tn('history.count', props.total)}</span>
          <span class="spacer"></span>
          {props.pages > 1 && <span class="muted">{t.t('links.page', { page: String(props.page), pages: String(props.pages) })}</span>}
          {props.page > 1 && <a href={url({ page: props.page - 1 })}>{t.t('translate.previousPage')}</a>}
          {props.page < props.pages && <a href={url({ page: props.page + 1 })}>{t.t('translate.nextPage')}</a>}
        </div>
      </section>
    </Layout>
  );
}

/** One translation with all its results (a link from the history). */
export function JobPage(props: { ctx: PageContext; account: Account; job: Job; appBase: string }) {
  const { ctx, job } = props;
  const { t } = ctx;
  return (
    <Layout ctx={ctx} title={t.t('history.pageHeading')}>
      <p>
        <a href="/history">{t.t('history.back')}</a>
      </p>
      <section id="job-panel" data-job={job.status === 'running' ? job.id : undefined}>
        <JobPanel t={t} job={job} portalId={props.account.accountId} appBase={props.appBase} />
      </section>
      <p>
        <a href={appUrl('/', { kind: job.kind, job: job.id })}>{t.t('history.openInTranslate')}</a>
      </p>
    </Layout>
  );
}

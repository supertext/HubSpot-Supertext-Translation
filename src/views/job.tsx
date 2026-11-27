import { editorUrl } from '../hubspot/content.js';
import type { MessageKey, Translator } from '../i18n/index.js';
import type { Job, JobItem } from '../store/store.js';
import { jobItemIds, jobSize, jobTitle, jobTotals } from '../translation/jobs.js';
import { languageName } from '../translation/languages.js';

/** The job's name: the item, or "About us and 4 more" for a batch. */
export function jobName(t: Translator, job: Job): string {
  const ids = jobItemIds(job);
  const first = jobTitle(job, ids[0]) || ids[0];
  return ids.length > 1 ? t.tn('job.batchName', ids.length - 1, { first }) : first;
}

/** Progress and results of a translation job (rendered on the server, refreshed by polling). */
export function JobPanel(props: { t: Translator; job: Job; portalId: string; appBase: string }) {
  const { t, job } = props;
  const totals = jobTotals(job);
  const ids = jobItemIds(job);
  const batch = ids.length > 1;
  const open = (item: JobItem) =>
    item.state !== 'failed' &&
    item.targetId && (
      <a href={editorUrl(job.kind, props.portalId, item.targetId, props.appBase)} target="_blank" rel="noopener">
        {t.t('job.open')}
      </a>
    );
  return (
    <div class="card job">
      <h2>
        {t.t('job.heading')}: {jobName(t, job)}
      </h2>
      <p class="muted">{t.t(`kind.${job.kind}` as MessageKey)}</p>
      {job.status === 'running' && (
        <p class="progress" role="status">
          <span class="spinner" aria-hidden="true"></span>
          {batch
            ? t.t('job.runningBatch', { completed: job.items.length, total: jobSize(job), items: ids.length })
            : t.t('job.running', { item: job.itemTitle || job.itemId, completed: job.items.length, total: job.languages.length })}
        </p>
      )}
      {job.status === 'done' && (
        <div class={`notice ${totals.failed > 0 ? 'warning' : 'success'}`}>{t.t('job.done', totals)}</div>
      )}
      {job.status === 'failed' && job.error && (
        <div class="notice error">{t.t('job.failed', { reason: t.error(job.error) })}</div>
      )}
      {!batch && job.items.length > 0 && (
        <table class="results">
          <tbody>
            {job.items.map((item) => (
              <tr>
                <td class="title">{languageName(item.language, t.locale)}</td>
                <td>
                  <ItemResult t={t} item={item} />
                </td>
                <td class="link">{open(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {batch && job.items.length > 0 && (
        <div class="table-scroll">
          <table class="results batch">
            <thead>
              <tr>
                <th></th>
                {job.languages.map((code) => (
                  <th class="lang-code">
                      <abbr title={languageName(code, t.locale)}>{code.toUpperCase()}</abbr>
                    </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ids
                .filter((id) => job.items.some((item) => item.itemId === id))
                .map((id) => {
                  const results = job.items.filter((item) => item.itemId === id);
                  const byLanguage = new Map(results.map((item) => [item.language, item]));
                  // The same error for every language (the item couldn't be loaded): said once.
                  const first = results[0];
                  const same =
                    results.length === job.languages.length &&
                    results.every((item) => item.state === 'failed' && item.error?.code && item.error.code === first.error?.code);
                  return (
                    <tr>
                      <td class="title">{jobTitle(job, id) || id}</td>
                      {same ? (
                        <td class="cell" colspan={job.languages.length}>
                          <ItemResult t={t} item={first} />
                        </td>
                      ) : (
                        job.languages.map((code) => {
                          const item = byLanguage.get(code);
                          return (
                            <td class="cell">
                              {item ? (
                                <>
                                  <ItemResult t={t} item={item} /> {open(item)}
                                </>
                              ) : job.status === 'running' ? (
                                <span class="spinner" aria-hidden="true"></span>
                              ) : (
                                ''
                              )}
                            </td>
                          );
                        })
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      {job.status === 'done' && <ReviewHint t={t} items={job.items} />}
    </div>
  );
}

/** What happened to one language version: created/updated (draft or published), kept, failed. */
export function ItemResult(props: { t: Translator; item: Pick<JobItem, 'state' | 'error' | 'published' | 'publishError'> }) {
  const { t, item } = props;
  if (item.state === 'failed') {
    return <span class="result failed">{item.error ? t.error(item.error) : ''}</span>;
  }
  const label = item.published && item.state !== 'kept' ? t.t(item.state === 'created' ? 'job.createdPublished' : 'job.updatedPublished') : t.t(`job.${item.state}`);
  return (
    <>
      <span class={`result ${item.state}`}>{label}</span>
      {item.publishError && <span class="result failed"> {t.t('job.notPublished', { reason: t.error(item.publishError) })}</span>}
    </>
  );
}

/** The line under the results: review the drafts, or check the published versions. */
export function ReviewHint(props: { t: Translator; items: Pick<JobItem, 'state' | 'published'>[] }) {
  const written = props.items.filter((item) => item.state === 'created' || item.state === 'updated');
  if (written.length === 0) return <></>;
  return <p class="help">{props.t.t(written.every((item) => item.published) ? 'job.reviewPublished' : 'job.review')}</p>;
}

/** Jobs as table rows: when, what (a link to the job), kind, languages, outcome. Shared by the Translate and History pages. */
export function JobRows(props: { t: Translator; jobs: Job[] }) {
  const { t } = props;
  const date = new Intl.DateTimeFormat(t.locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <table class="results history-table">
      <tbody>
        {props.jobs.map((job) => {
          const totals = jobTotals(job);
          return (
            <tr>
              <td class="when">{date.format(new Date(job.createdAt))}</td>
              <td class="title">
                <a href={`/history/${encodeURIComponent(job.id)}`}>{jobName(t, job)}</a>
              </td>
              <td class="muted">{t.t(`kind.${job.kind}` as MessageKey)}</td>
              <td class="codes">
                {job.languages.map((code, index) => (
                  <span>
                    {code.toUpperCase()}
                    {index < job.languages.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </td>
              <td>
                {job.status === 'running' ? (
                  <span class="spinner" aria-hidden="true"></span>
                ) : job.status === 'failed' && job.error ? (
                  <span class="result failed">{t.error(job.error)}</span>
                ) : (
                  <span class={totals.failed > 0 ? 'result failed' : 'result created'}>{t.t('job.done', totals)}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The last translations, newest first, and the way to all of them. */
export function History(props: { t: Translator; jobs: Job[] }) {
  const { t, jobs } = props;
  return (
    <section class="card history">
      <h2>{t.t('history.heading')}</h2>
      {jobs.length === 0 ? <p class="muted">{t.t('history.empty')}</p> : <JobRows t={t} jobs={jobs} />}
      <p>
        <a href="/history">{t.t('history.all')}</a>
      </p>
    </section>
  );
}

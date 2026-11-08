import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type ReviewWorkspace as Data,
  type ReviewCommand as Command,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
import { exportRows } from './workspace';
export default function Reviews({
  group,
  device,
}: {
  group: string;
  device: string;
}) {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [source, setSource] = useState(''),
    [reason, setReason] = useState(''),
    [selected, setSelected] = useState(''),
    [outcome, setOutcome] = useState(''),
    [proposalReason, setProposalReason] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const pending = useRef<Command | null>(null);
  async function load() {
    setBusy(true);
    setError('');
    try {
      setData(await api.reviews(group));
    } catch {
      setError(t('reviewsLoadError'));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void api
      .reviews(group)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setError(t('reviewsLoadError'));
      });
    return () => {
      alive = false;
    };
  }, [group]);
  async function send(body: Command) {
    pending.current = body;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.reviewCommand(group, body);
      pending.current = null;
      setConfirmed(false);
      setMessage(t('reviewsSaved'));
      try {
        setData(await api.reviews(group));
      } catch {
        setError(t('reviewsSavedRefresh'));
        setData(null);
      }
    } catch (e) {
      if (e instanceof ClientError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        setError(t('reviewsRejected'));
      } else setError(t('reviewsUncertain'));
    } finally {
      setBusy(false);
    }
  }
  function command(action: Command['action'], extra: Partial<Command> = {}) {
    void send({
      request_id: newTransactionId(),
      device_id: device,
      action,
      kind: null,
      source_type: null,
      source_id: null,
      review_id: null,
      proposal_id: null,
      outcome: null,
      reason: '',
      ...extra,
    });
  }
  function open(e: FormEvent) {
    e.preventDefault();
    const [type, id] = source.split(':');
    command('open', {
      kind: 'closed_record',
      source_type: type as Command['source_type'],
      source_id: id!,
      reason: reason.trim(),
    });
  }
  const frozen = busy || pending.current !== null;
  const can = data?.can_decide ?? false;
  const label = (value: string) =>
    t(value === 'confirmed' ? 'reviewsConfirmed' : 'reviewsCorrection');
  function download() {
    if (!data) return;
    const rows = [
      [
        'Review ID',
        'Kind',
        'Source type',
        'Source ID',
        'Request reason',
        'Requested by',
        'Requested at',
        'Proposed outcome',
        'Proposal reason',
        'Resolution',
        'Resolution date',
      ],
      ...data.reviews.map((r) => [
        r.id,
        r.kind,
        r.source_type,
        r.source_id,
        r.reason,
        r.entered_by,
        r.recorded_at,
        r.proposal?.outcome ?? '',
        r.proposal?.reason ?? '',
        r.resolution?.outcome ?? '',
        r.resolution?.recorded_at ?? '',
      ]),
    ];
    const url = URL.createObjectURL(
        new Blob([exportRows(rows)], { type: 'text/csv;charset=utf-8' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = `yapesa-reviews-${group}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="reviews-workspace" aria-label={t('reviewsTitle')}>
      <div className="panel-heading">
        <h2>{t('reviewsTitle')}</h2>
        <button
          className="button secondary"
          disabled={frozen}
          onClick={() => void load()}
        >
          {t('reviewsRefresh')}
        </button>
      </div>
      <p>{t('reviewsIntro')}</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending.current && (
        <button
          className="button"
          disabled={busy}
          onClick={() => void send(pending.current!)}
        >
          {t('reviewsRetry')}
        </button>
      )}
      {data && (
        <>
          {!can && <p>{t('reviewsReadOnly')}</p>}
          <section className="panel">
            <h3>{t('reviewsMismatches')}</h3>
            {!data.mismatches.length && <p>{t('reviewsNoMismatches')}</p>}
            {data.mismatches.map((m) => (
              <div key={`${m.type}-${m.id}`} className="review-difference">
                <strong>{m.name}</strong>
                <p>
                  {t('reviewsReference')}: {m.id}
                </p>
                {m.review_id ? (
                  <p>{t('reviewsLinked')}</p>
                ) : (
                  can && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        command('open', {
                          kind: 'calculation',
                          source_type: m.type,
                          source_id: m.id,
                          reason: String(form.get('reason')).trim(),
                        });
                      }}
                    >
                      <label>
                        {t('reviewsReason')}
                        <textarea
                          name="reason"
                          required
                          maxLength={500}
                          disabled={frozen}
                        />
                      </label>
                      <button className="button" disabled={frozen}>
                        {t('reviewsOpen')}
                      </button>
                    </form>
                  )
                )}
              </div>
            ))}
          </section>
          {can && (
            <section className="panel">
              <h3>{t('reviewsClosedTitle')}</h3>
              <p>{t('reviewsClosedIntro')}</p>
              <form onSubmit={open}>
                <label>
                  {t('reviewsClosedSource')}
                  <select
                    aria-label={t('reviewsClosedSource')}
                    required
                    value={source}
                    disabled={frozen}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">{t('reviewsChooseSource')}</option>
                    {data.closed_sources.map((s) => (
                      <option
                        key={`${s.type}:${s.id}`}
                        value={`${s.type}:${s.id}`}
                      >
                        {t(
                          s.type === 'meeting'
                            ? 'reviewsMeeting'
                            : 'reviewsShareout',
                        )}{' '}
                        — {s.date} — {s.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('reviewsReason')}
                  <textarea
                    required
                    maxLength={500}
                    value={reason}
                    disabled={frozen}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  className="button"
                  disabled={frozen || !source || !reason.trim()}
                >
                  {t('reviewsRequest')}
                </button>
              </form>
            </section>
          )}
          <div className="panel-heading">
            <h3>{t('reviewsCases')}</h3>
            <button
              className="button secondary"
              onClick={download}
              disabled={!data.reviews.length}
            >
              {t('reviewsExport')}
            </button>
          </div>
          {!data.reviews.length && <p>{t('reviewsEmpty')}</p>}
          {data.reviews.map((r) => (
            <article className="panel review-case" key={r.id}>
              <h3>
                {r.kind === 'calculation'
                  ? t('reviewsMismatches')
                  : t('reviewsClosedTitle')}
              </h3>
              <p>{r.reason}</p>
              <p>
                {t('reviewsReference')}: {r.source_id}
              </p>
              <details>
                <summary>{t('reviewsEvidence')}</summary>
                <pre>{JSON.stringify(r.source, null, 2)}</pre>
              </details>
              {r.resolution ? (
                <>
                  <p role="status">
                    {t('reviewsDecision')}: {label(r.resolution.outcome)}
                  </p>
                  <p>{t('reviewsOriginalLocked')}</p>
                </>
              ) : (
                <>
                  {r.proposal && (
                    <div className="review-proposal">
                      <h4>
                        {t('reviewsLatest')}: {label(r.proposal.outcome)}
                      </h4>
                      <p>{r.proposal.reason}</p>
                      <p>
                        {t('reviewsApprovals')}:{' '}
                        {r.proposal.approvals.filter((a) => a.eligible).length}{' '}
                        / 2
                      </p>
                      {r.proposal.approvals.some(
                        (a) => a.officer_id === data.actor_id,
                      ) ? (
                        <p>{t('reviewsAlreadyApproved')}</p>
                      ) : (
                        can && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              command('approve', {
                                review_id: r.id,
                                proposal_id: r.proposal!.id,
                              });
                            }}
                          >
                            <label className="check-label">
                              <input
                                type="checkbox"
                                required
                                disabled={frozen}
                                checked={selected === r.id && confirmed}
                                onChange={(e) => {
                                  setSelected(r.id);
                                  setConfirmed(e.target.checked);
                                }}
                              />
                              {t('reviewsApproveConfirm')}
                            </label>
                            <button
                              className="button"
                              disabled={
                                frozen || selected !== r.id || !confirmed
                              }
                            >
                              {t('reviewsApprove')}
                            </button>
                          </form>
                        )
                      )}
                    </div>
                  )}
                  {can && (
                    <details
                      onToggle={(e) => {
                        if (e.currentTarget.open) {
                          setSelected(r.id);
                          setOutcome('');
                          setProposalReason('');
                          setConfirmed(false);
                        }
                      }}
                    >
                      <summary>{t('reviewsPropose')}</summary>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          command('propose', {
                            review_id: r.id,
                            outcome: outcome as Command['outcome'],
                            reason: proposalReason.trim(),
                          });
                        }}
                      >
                        <label>
                          {t('reviewsOutcome')}
                          <select
                            aria-label={t('reviewsOutcome')}
                            required
                            value={selected === r.id ? outcome : ''}
                            disabled={frozen}
                            onChange={(e) => {
                              setSelected(r.id);
                              setOutcome(e.target.value);
                              setConfirmed(false);
                            }}
                          >
                            <option value="">
                              {t('reviewsChooseOutcome')}
                            </option>
                            <option value="confirmed">
                              {t('reviewsConfirmed')}
                            </option>
                            <option value="correction_required">
                              {t('reviewsCorrection')}
                            </option>
                          </select>
                        </label>
                        <label>
                          {t('reviewsProposedReason')}
                          <textarea
                            required
                            maxLength={500}
                            value={selected === r.id ? proposalReason : ''}
                            disabled={frozen}
                            onChange={(e) => {
                              setSelected(r.id);
                              setProposalReason(e.target.value);
                            }}
                          />
                        </label>
                        <button
                          className="button"
                          disabled={
                            frozen ||
                            selected !== r.id ||
                            !outcome ||
                            !proposalReason.trim()
                          }
                        >
                          {t('reviewsProposeSave')}
                        </button>
                      </form>
                    </details>
                  )}
                </>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}

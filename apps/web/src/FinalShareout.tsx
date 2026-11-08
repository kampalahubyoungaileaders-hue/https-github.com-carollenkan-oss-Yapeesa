import { useEffect, useRef, useState } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type FinalShareout as Data,
  type FinalShareoutCommand as Command,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
import { exportRows } from './workspace';
export default function FinalShareout({
  group,
  device,
  format,
  onChanged,
}: {
  group: string;
  device: string;
  format: (minor: string) => string;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false),
    [selected, setSelected] = useState(''),
    [reason, setReason] = useState('');
  const pending = useRef<Command | null>(null);
  async function load() {
    setBusy(true);
    setError('');
    try {
      setData(await api.finalShareout(group));
      setConfirmed(false);
    } catch {
      setError(t('finalError'));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void api
      .finalShareout(group)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setError(t('finalError'));
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
      await api.shareoutCommand(group, body);
      pending.current = null;
      setConfirmed(false);
      setSelected('');
      setReason('');
      setMessage(t('finalSaved'));
      try {
        setData(await api.finalShareout(group));
        await onChanged();
      } catch {
        setError(t('finalSavedRefresh'));
        setData(null);
      }
    } catch (e) {
      if (e instanceof ClientError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        setError(t('finalRejected'));
      } else setError(t('finalUncertain'));
    } finally {
      setBusy(false);
    }
  }
  function command(action: Command['action']) {
    void send({
      request_id: newTransactionId(),
      device_id: device,
      action,
      plan_id: action === 'prepare' ? null : data!.plan!.id,
      allocation_id: action === 'pay' ? selected : null,
      reason: action === 'pay' ? reason.trim() : '',
      confirmed: true,
    });
  }
  const plan = data?.plan,
    snapshot = plan?.snapshot ?? data?.readiness.snapshot,
    frozen = busy || pending.current !== null;
  const remaining =
    plan?.allocations.filter((a) => a.amount !== '0' && !a.receipt) ?? [];
  const chosen = remaining.find((a) => a.id === selected);
  const approvals = plan?.approvals.filter((a) => a.eligible).length ?? 0;
  const own =
    plan?.approvals.some((a) => a.officer_id === data?.actor_id) ?? false;
  function download() {
    if (!plan) return;
    const rows = [
      [
        'Cycle ID',
        'Plan ID',
        'Calculation version',
        'Member ID',
        'Member',
        'Shares',
        'Allocation (minor units)',
        'Currency',
        'Receipt ID',
        'Recorded at',
        'Recorded by',
        'Receipt note',
      ],
      ...plan.allocations.map((a) => [
        plan.cycle_id,
        plan.id,
        plan.calc_version,
        a.member_id,
        a.name,
        a.shares,
        a.amount,
        data!.currency,
        a.receipt?.id ?? '',
        a.receipt?.recorded_at ?? '',
        a.receipt?.entered_by ?? '',
        a.receipt?.reason ?? '',
      ]),
    ];
    const url = URL.createObjectURL(
        new Blob([exportRows(rows)], { type: 'text/csv;charset=utf-8' }),
      ),
      link = document.createElement('a');
    link.href = url;
    link.download = `yapesa-shareout-${plan.cycle_id}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="panel final-shareout"
      aria-labelledby="final-shareout-title"
    >
      <div className="panel-heading">
        <h2 id="final-shareout-title">{t('finalTitle')}</h2>
        <button
          className="button secondary"
          disabled={frozen}
          onClick={() => void load()}
        >
          {t('finalRefresh')}
        </button>
      </div>
      <p>{t('finalIntro')}</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending.current && (
        <button
          className="button"
          disabled={busy}
          onClick={() => void send(pending.current!)}
        >
          {t('finalRetry')}
        </button>
      )}
      {data && (
        <>
          {!plan?.committed && (
            <div>
              <h3>
                {t(
                  data.readiness.blockers.length
                    ? 'finalBlocked'
                    : 'finalReady',
                )}
              </h3>
              {data.readiness.blockers.length > 0 && (
                <ul>
                  {data.readiness.blockers.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {snapshot && (
            <dl className="shareout-totals">
              <div>
                <dt>{t('finalFund')}</dt>
                <dd>{format(snapshot.preview.fund)}</dd>
              </div>
              <div>
                <dt>{t('finalCash')}</dt>
                <dd>{format(snapshot.cash)}</dd>
              </div>
              <div>
                <dt>{t('finalSocial')}</dt>
                <dd>{format(snapshot.social)}</dd>
              </div>
            </dl>
          )}
          {plan && (
            <>
              <h3>{t('finalReview')}</h3>
              <p>
                {plan.calc_version} · {plan.id}
              </p>
              {!plan.current && !plan.committed && (
                <p role="alert">{t('finalStale')}</p>
              )}
              <div className="shareout-table-wrap">
                <table aria-label="Final share-out allocation">
                  <thead>
                    <tr>
                      <th>{t('member')}</th>
                      <th>{t('sharesLabel')}</th>
                      <th>{t('shareoutAllocation')}</th>
                      <th>{t('finalReceipt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.snapshot.preview.members.map((m) => {
                      const a = plan.allocations.find(
                        (a) => a.member_id === m.id,
                      );
                      return (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td>{m.shares}</td>
                          <td>{format(m.amount)}</td>
                          <td>
                            {a?.receipt
                              ? t('finalPaid')
                              : m.amount === '0'
                                ? t('finalZero')
                                : t('finalPending')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p>
                {t('finalApprovalCount')}: {approvals} / 2
              </p>
              {plan.committed ? (
                <p role="status">
                  {t(plan.finalized ? 'finalDone' : 'finalApproved')}
                </p>
              ) : own ? (
                <p>{t('finalAlreadyApproved')}</p>
              ) : (
                plan.current &&
                data.can_approve && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      command('approve');
                    }}
                  >
                    <label className="check-label">
                      <input
                        type="checkbox"
                        required
                        checked={confirmed}
                        disabled={frozen}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      {t('finalApproveConfirm')}
                    </label>
                    <button className="button" disabled={frozen || !confirmed}>
                      {t('finalApprove')}
                    </button>
                  </form>
                )
              )}
              {plan.committed && (
                <>
                  <button className="button secondary" onClick={download}>
                    {t('finalExport')}
                  </button>
                  <p>
                    {t('finalRemaining')}:{' '}
                    {format(
                      String(
                        remaining.reduce(
                          (sum, a) => sum + BigInt(a.amount),
                          0n,
                        ),
                      ),
                    )}
                  </p>
                </>
              )}
              {plan.committed &&
                !plan.finalized &&
                data.can_record &&
                (remaining.length > 0 ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      command('pay');
                    }}
                  >
                    <h3>{t('finalPayTitle')}</h3>
                    <label>
                      {t('finalPayMember')}
                      <select
                        aria-label={t('finalPayMember')}
                        required
                        value={selected}
                        disabled={frozen}
                        onChange={(e) => {
                          setSelected(e.target.value);
                          setConfirmed(false);
                        }}
                      >
                        <option value="">{t('finalChooseMember')}</option>
                        {remaining.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} — {format(a.amount)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {chosen && (
                      <p>
                        <strong>
                          {chosen.name}: {format(chosen.amount)}
                        </strong>
                      </p>
                    )}
                    <label>
                      {t('finalPayReason')}
                      <input
                        required
                        maxLength={240}
                        value={reason}
                        disabled={frozen}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        required
                        checked={confirmed}
                        disabled={frozen}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      {t('finalPayConfirm')}
                    </label>
                    <button
                      className="button"
                      disabled={
                        frozen || !confirmed || !chosen || !reason.trim()
                      }
                    >
                      {t('finalPay')}
                    </button>
                  </form>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      command('finish');
                    }}
                  >
                    <label className="check-label">
                      <input
                        type="checkbox"
                        required
                        checked={confirmed}
                        disabled={frozen}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      {t('finalFinishConfirm')}
                    </label>
                    <button className="button" disabled={frozen || !confirmed}>
                      {t('finalFinish')}
                    </button>
                  </form>
                ))}
            </>
          )}
          {data.can_record &&
            !plan?.committed &&
            data.readiness.blockers.length === 0 &&
            (!plan || !plan.current) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  command('prepare');
                }}
              >
                <label className="check-label">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    disabled={frozen}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  {t('finalPrepareConfirm')}
                </label>
                <button className="button" disabled={frozen || !confirmed}>
                  {t('finalPrepare')}
                </button>
              </form>
            )}
        </>
      )}
    </section>
  );
}

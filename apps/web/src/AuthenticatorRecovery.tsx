import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type RecoveryWorkspace,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
type Case = RecoveryWorkspace['cases'][number];
function Review({
  item,
  actor,
  onChanged,
}: {
  item: Case;
  actor: string;
  onChanged: () => Promise<void>;
}) {
  const [evidence, setEvidence] = useState(''),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const command = useRef<{ id: string; evidence: string } | null>(null);
  const own = item.person_id === actor,
    approved = item.approvals.some((a) => a.actor_id === actor),
    count = item.approvals.filter(
      (a) => a.eligible && a.actor_id !== item.person_id,
    ).length;
  async function approve(event: FormEvent) {
    event.preventDefault();
    command.current ??= { id: newTransactionId(), evidence: evidence.trim() };
    setPending(true);
    setBusy(true);
    setError('');
    try {
      await api.recoveryApprove(
        item.id,
        command.current.id,
        command.current.evidence,
        true,
      );
      command.current = null;
      setPending(false);
      setNotice(t('mfaRecoverySaved'));
      await onChanged();
    } catch (error) {
      if (
        error instanceof ClientError &&
        [400, 409, 422].includes(error.status)
      ) {
        command.current = null;
        setPending(false);
      }
      setError(t('mfaRecoveryError'));
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    setError('');
    try {
      await api.recoveryReset(item.id);
      setNotice(t('mfaRecoverySaved'));
      await onChanged();
    } catch {
      setError(t('mfaRecoveryError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="admin-card">
      <h3>{item.name}</h3>
      <p>{item.phone}</p>
      <p>{item.reason}</p>
      <p>{item.id}</p>
      <p>
        {t('mfaApprovalCount')}: {count} / 2
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {item.recovered ? (
        <p>{t('mfaRecovered')}</p>
      ) : item.reset ? (
        <p>{t('mfaResetDone')}</p>
      ) : own ? (
        <p>{t('mfaSelf')}</p>
      ) : (
        <>
          {!approved && !item.prepared && (
            <form onSubmit={(e) => void approve(e)}>
              <div className="form-group">
                <label htmlFor={`identity-${item.id}`}>
                  {t('mfaEvidence')}
                </label>
                <textarea
                  id={`identity-${item.id}`}
                  required
                  maxLength={500}
                  disabled={busy || pending}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                />
              </div>
              <label>
                <input
                  type="checkbox"
                  required
                  disabled={busy || pending}
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                />
                {t('mfaAttest')}
              </label>
              <button
                className="button"
                disabled={busy || !verified}
                type="submit"
              >
                {t('mfaApprove')}
              </button>
            </form>
          )}
          <button
            className="button"
            disabled={busy || count < 2 || pending}
            onClick={() => void reset()}
          >
            {t(item.prepared ? 'mfaResetRetry' : 'mfaReset')}
          </button>
        </>
      )}
    </article>
  );
}
export default function AuthenticatorRecovery() {
  const [data, setData] = useState<RecoveryWorkspace | null>(null),
    [actor, setActor] = useState(''),
    [error, setError] = useState('');
  async function load() {
    setData(await api.recoveryWorkspace());
  }
  useEffect(() => {
    let alive = true;
    void Promise.all([api.recoveryWorkspace(), api.session()])
      .then(([workspace, session]) => {
        if (alive) {
          setData(workspace);
          setActor(session.user?.person_id ?? '');
        }
      })
      .catch(() => {
        if (alive) setError(t('mfaRecoveryError'));
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="admin-card" aria-label={t('mfaRecoveryTitle')}>
      <h2>{t('mfaRecoveryTitle')}</h2>
      <p>{t('mfaRecoveryHelp')}</p>
      <button
        className="button"
        onClick={() => void load().catch(() => setError(t('mfaRecoveryError')))}
      >
        {t('adminRefresh')}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {data?.cases.length === 0 && <p>{t('mfaRecoveryEmpty')}</p>}
      {data?.cases.map((item) => (
        <Review key={item.id} item={item} actor={actor} onChanged={load} />
      ))}
    </section>
  );
}

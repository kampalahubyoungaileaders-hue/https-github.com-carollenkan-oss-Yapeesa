import { useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type ShareReversal,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';

export default function ShareCorrection({
  group,
  transaction,
  device,
  onSaved,
}: {
  group: string;
  transaction: string;
  device: string;
  onSaved: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = useRef<ShareReversal | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const input = pending.current ?? {
      transaction_id: transaction,
      device_id: device,
      client_id: newTransactionId(),
      reason: reason.trim(),
    };
    pending.current = input;
    try {
      await api.reverseShares(group, input);
      pending.current = null;
      setSaved(true);
      try {
        await onSaved();
      } catch {
        setError(t('correctionRefresh'));
      }
    } catch (failure) {
      const rejected =
        failure instanceof ClientError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (rejected) pending.current = null;
      setError(t(rejected ? 'correctionRejected' : 'correctionUncertain'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="correction-panel">
      {saved ? (
        <p role="status">{t('correctionSaved')}</p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <h3>{t('reversePurchase')}</h3>
          <p>{t('correctionExplanation')}</p>
          <label htmlFor="correction-reason">{t('correctionReason')}</label>
          <input
            id="correction-reason"
            value={reason}
            maxLength={240}
            required
            disabled={busy || pending.current !== null}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            className="button secondary"
            type="submit"
            disabled={busy || !reason.trim()}
          >
            {t(
              busy
                ? 'savingRecord'
                : pending.current
                  ? 'correctionRetry'
                  : 'reversePurchase',
            )}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

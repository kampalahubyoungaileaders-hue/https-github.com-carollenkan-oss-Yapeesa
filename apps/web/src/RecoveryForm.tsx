import { useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  type Recovery,
  type Factor,
  newTransactionId,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';

export default function RecoveryForm({ onCancel }: { onCancel: () => void }) {
  const [phase, setPhase] = useState<
    'sms' | 'mfa' | 'pin' | 'finish' | 'done' | 'waiting'
  >('sms');
  const [lost, setLost] = useState(false);
  const [reason, setReason] = useState('');
  const [newFactor, setNewFactor] = useState<Factor | null>(null);
  const savedRequest = useRef<{ id: string; reason: string } | null>(null);
  const [pendingRequest, setPendingRequest] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState('');
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(
        t(
          error instanceof ClientError && error.status === 429
            ? 'rateLimited'
            : phase === 'pin' &&
                error instanceof ClientError &&
                ['NETWORK_ERROR', 'BACKEND_UNAVAILABLE'].includes(error.code)
              ? 'recoveryUncertain'
              : 'recoveryError',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const value =
        phase === 'sms'
          ? await api.recoveryVerify(phone, code)
          : await api.recoveryMfa(
              newFactor?.id || factor || recovery!.factors[0]!.id,
              code,
            );
      setRecovery(value);
      setCode('');
      setNotice('');
      setPhase(value.requires_mfa && !value.mfa_verified ? 'mfa' : 'pin');
    });
    setCode('');
  }
  async function complete(event: FormEvent) {
    event.preventDefault();
    if (pin !== confirmation) {
      setError(t('pinMismatch'));
      return;
    }
    await run(async () => {
      const result = await api.recoveryComplete(pin);
      setPhase(result.cleanup_complete ? 'done' : 'finish');
    });
    setPin('');
    setConfirmation('');
  }
  return (
    <>
      <h2>{t('recoveryTitle')}</h2>
      <p>{t('recoveryHelp')}</p>
      {busy && <p role="status">{t('connectingSecurely')}</p>}
      {phase === 'sms' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api.recoveryCode(phone);
              setNotice(t('recoveryRequested'));
            });
          }}
        >
          <div className="form-group">
            <label htmlFor="recovery-phone">{t('phoneNumber')}</label>
            <input
              id="recovery-phone"
              type="tel"
              autoComplete="tel"
              required
              pattern="\+[1-9][0-9]{6,14}"
              value={phone}
              disabled={busy}
              onChange={(event) => {
                setPhone(event.target.value);
                setCode('');
                setNotice('');
              }}
            />
          </div>
          <button className="button" disabled={busy} type="submit">
            {t('requestSms')}
          </button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {phase === 'waiting' && (
        <div>
          <p>{t('mfaAwaiting')}</p>
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              setPhase('sms');
              setLost(false);
              setCode('');
              setNotice('');
              setNewFactor(null);
            }}
          >
            {t('mfaCheck')}
          </button>
        </div>
      )}
      {phase === 'mfa' && recovery?.enrollment_allowed && !newFactor && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setNewFactor(await api.recoveryEnroll());
            })
          }
        >
          {t('setupAuthenticator')}
        </button>
      )}
      {newFactor && (
        <div className="factor-setup">
          <p>{t('setupDescription')}</p>
          <label>
            {t('setupKey')}
            <input
              aria-label={t('setupKey')}
              readOnly
              value={newFactor.secret}
            />
          </label>
        </div>
      )}
      {phase === 'mfa' && !recovery?.enrollment_allowed && !lost && (
        <button
          className="button"
          disabled={busy}
          onClick={() => setLost(true)}
        >
          {t('mfaLost')}
        </button>
      )}
      {phase === 'mfa' && lost && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            savedRequest.current ??= {
              id: newTransactionId(),
              reason: reason.trim(),
            };
            setPendingRequest(true);
            void run(async () => {
              const result = await api.recoveryRequest(
                savedRequest.current!.id,
                savedRequest.current!.reason,
              );
              savedRequest.current = null;
              setPendingRequest(false);
              setNotice(`${t('mfaRequestSaved')} ${result.id}`);
              setPhase('waiting');
            });
          }}
        >
          <div className="form-group">
            <label htmlFor="lost-mfa-reason">{t('mfaReason')}</label>
            <textarea
              id="lost-mfa-reason"
              required
              maxLength={500}
              disabled={busy || pendingRequest}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <button className="button primary" disabled={busy}>
            {t(pendingRequest ? 'mfaRetryRequest' : 'mfaRequest')}
          </button>
        </form>
      )}
      {(phase === 'sms' ||
        (phase === 'mfa' &&
          !lost &&
          (!recovery?.enrollment_allowed || newFactor))) && (
        <form onSubmit={(event) => void verify(event)}>
          {phase === 'mfa' && recovery && recovery.factors.length > 1 && (
            <div className="form-group">
              <label htmlFor="recovery-factor">{t('authenticator')}</label>
              <select
                id="recovery-factor"
                value={factor || recovery.factors[0]!.id}
                disabled={busy}
                onChange={(event) => setFactor(event.target.value)}
              >
                {recovery.factors.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="recovery-code">
              {t(phase === 'sms' ? 'smsCode' : 'verificationCode')}
            </label>
            <input
              id="recovery-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button
            className="button primary"
            type="submit"
            disabled={
              busy || (phase === 'sms' && !/^\+[1-9][0-9]{6,14}$/.test(phone))
            }
          >
            {t(phase === 'sms' ? 'recoveryVerify' : 'verifyCode')}
          </button>
        </form>
      )}
      {phase === 'pin' && (
        <form onSubmit={(event) => void complete(event)}>
          <div className="form-group">
            <label htmlFor="recovery-pin">{t('choosePin')}</label>
            <input
              id="recovery-pin"
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              value={pin}
              disabled={busy}
              onChange={(event) => setPin(event.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="recovery-confirm">{t('confirmPin')}</label>
            <input
              id="recovery-confirm"
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              value={confirmation}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <button className="button primary" disabled={busy} type="submit">
            {t('recoverySave')}
          </button>
        </form>
      )}
      {phase === 'finish' && (
        <>
          <p role="status">{t('recoveryCleanup')}</p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if ((await api.recoveryFinish()).cleanup_complete)
                  setPhase('done');
              })
            }
          >
            {t('recoveryRetry')}
          </button>
        </>
      )}
      {phase === 'done' && <p role="status">{t('recoverySuccess')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="text-button signout-link"
        disabled={busy}
        onClick={() => {
          if (phase === 'done') onCancel();
          else
            void run(async () => {
              await api.recoveryCancel();
              onCancel();
            });
        }}
      >
        {t('backToSignIn')}
      </button>
    </>
  );
}

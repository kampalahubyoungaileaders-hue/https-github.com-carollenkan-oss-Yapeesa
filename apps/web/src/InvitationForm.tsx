import { useState, type FormEvent } from 'react';
import { api, ClientError, type Session } from '@yapesa/api-client';
import { t } from '@yapesa/i18n';

export default function InvitationForm({
  onComplete,
  onCancel,
}: {
  onComplete: (session: Session) => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (pin !== confirmation) {
      setError(t('pinMismatch'));
      return;
    }
    setBusy(true);
    try {
      onComplete(await api.acceptInvitation(phone, code, pin));
    } catch (err) {
      setError(
        t(
          err instanceof ClientError && err.status === 429
            ? 'rateLimited'
            : 'invitationError',
        ),
      );
    } finally {
      setCode('');
      setPin('');
      setConfirmation('');
      setBusy(false);
    }
  }
  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.requestInvitationCode(phone);
      setNotice(t('smsRequested'));
    } catch (err) {
      setError(
        t(
          err instanceof ClientError && err.status === 429
            ? 'rateLimited'
            : 'requestError',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>{t('invitationDescription')}</p>
      <form onSubmit={requestCode}>
        <div className="form-group">
          <label htmlFor="invite-phone">{t('phoneNumber')}</label>
          <input
            id="invite-phone"
            type="tel"
            autoComplete="tel"
            required
            pattern="\+[1-9][0-9]{6,14}"
            placeholder="+256…"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setNotice('');
              setCode('');
            }}
            disabled={busy}
          />
        </div>
        <button className="button" disabled={busy} type="submit">
          {t('requestSms')}
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={submit}>
        <div className="form-group">
          <label htmlFor="invite-code">{t('smsCode')}</label>
          <input
            id="invite-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            required
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="form-group">
          <label htmlFor="invite-pin">{t('choosePin')}</label>
          <input
            id="invite-pin"
            type="password"
            autoComplete="new-password"
            inputMode="numeric"
            required
            pattern="[0-9]{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="form-group">
          <label htmlFor="invite-confirm">{t('confirmPin')}</label>
          <input
            id="invite-confirm"
            type="password"
            autoComplete="new-password"
            inputMode="numeric"
            required
            pattern="[0-9]{6}"
            maxLength={6}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={busy}
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary login-submit"
          type="submit"
          disabled={busy || !/^\+[1-9][0-9]{6,14}$/.test(phone)}
        >
          {t('activateInvitation')}
        </button>
      </form>
      <button
        className="text-button signout-link"
        onClick={onCancel}
        disabled={busy}
      >
        {t('backToSignIn')}
      </button>
    </>
  );
}

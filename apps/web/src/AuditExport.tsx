import { useState, type FormEvent } from 'react';
import { api, ClientError } from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
export default function AuditExport({
  group,
  timeZone,
}: {
  group: string;
  timeZone: string;
}) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const previous = new Date(`${today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 30);
  const [from, setFrom] = useState(previous.toISOString().slice(0, 10)),
    [to, setTo] = useState(today),
    [reference, setReference] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function download(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const blob = await api.audit(
        group,
        from,
        to,
        reference.trim() || undefined,
      );
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `yapesa-audit-${group}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(t('auditReady'));
    } catch (error) {
      setError(
        t(
          error instanceof ClientError && error.code === 'AUDIT_TOO_LARGE'
            ? 'auditTooLarge'
            : 'auditError',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-card" aria-label={t('auditTitle')}>
      <h2>{t('auditTitle')}</h2>
      <p>{t('auditHelp')}</p>
      <p>{timeZone}</p>
      <form onSubmit={(event) => void download(event)}>
        <div className="form-group">
          <label htmlFor="audit-from">{t('auditFrom')}</label>
          <input
            id="audit-from"
            type="date"
            required
            disabled={busy}
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="audit-to">{t('auditTo')}</label>
          <input
            id="audit-to"
            type="date"
            required
            disabled={busy}
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="audit-reference">{t('auditReferenceInput')}</label>
          <input
            id="audit-reference"
            disabled={busy}
            value={reference}
            pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"
            onChange={(event) => setReference(event.target.value)}
          />
        </div>
        <button className="button primary" disabled={busy}>
          {t('auditDownload')}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

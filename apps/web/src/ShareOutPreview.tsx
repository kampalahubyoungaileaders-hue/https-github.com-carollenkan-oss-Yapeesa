import { useState } from 'react';
import { api, type ShareOutPreview as Preview } from '@yapesa/api-client';
import { t } from '@yapesa/i18n';

export default function ShareOutPreview({
  group,
  format,
}: {
  group: string;
  format: (minor: string) => string;
}) {
  const [data, setData] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true);
    setError('');
    setData(null);
    try {
      setData(await api.shareOutPreview(group));
    } catch {
      setError(t('shareoutError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel shareout-panel">
      <div className="panel-heading">
        <h2>{t('shareoutTitle')}</h2>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {t(
            busy ? 'loadingRecords' : data ? 'shareoutRefresh' : 'shareoutShow',
          )}
        </button>
      </div>
      <p>{t('shareoutScope')}</p>
      {error && <p role="alert">{error}</p>}
      {data && data.loans_outstanding !== '0' && (
        <p>
          {t('loanPrincipalRemaining')}: {format(data.loans_outstanding)}.{' '}
          {t('loanOutstandingPreview')}
        </p>
      )}
      {data && (
        <>
          <p>
            <strong>
              {t('shareoutFund')}: {format(data.fund)}
            </strong>{' '}
            · {data.total_shares} {t('sharesLabel')}
          </p>
          {data.members.length ? (
            <div className="shareout-table-wrap">
              <table aria-label={t('shareoutTitle')}>
                <thead>
                  <tr>
                    <th>{t('member')}</th>
                    <th>{t('sharesLabel')}</th>
                    <th>{t('shareoutAllocation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.shares}</td>
                      <td>{format(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{t('shareoutEmpty')}</p>
          )}
          {data.members.reduce((sum, row) => sum + BigInt(row.amount), 0n) ===
            BigInt(data.fund) && <p role="status">{t('shareoutExact')}</p>}
          <p>{t('shareoutRounding')}</p>
          <small>{data.calc_version}</small>
        </>
      )}
    </section>
  );
}

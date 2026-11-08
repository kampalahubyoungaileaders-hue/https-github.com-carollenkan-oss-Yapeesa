import { useState, type FormEvent } from 'react';
import type { AdminWorkspace, AdminNewCycleInput } from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
export default function NewCycle({
  group,
  busy,
  pending,
  submit,
}: {
  group: AdminWorkspace['groups'][number];
  busy: boolean;
  pending: string | null;
  submit: (
    value: Omit<AdminNewCycleInput, 'request_id' | 'device_id'>,
  ) => Promise<boolean>;
}) {
  const [value, setValue] = useState({
      starts_on: '',
      ends_on: '',
      share_price: '',
    }),
    [confirmed, setConfirmed] = useState(false);
  const next = group.next_cycle,
    frozen = busy || pending !== null;
  async function save(e: FormEvent) {
    e.preventDefault();
    await submit(value);
  }
  if (group.cycle) return null;
  return (
    <section className="new-cycle" aria-label={t('cycleStartTitle')}>
      <h3>{t('cycleStartTitle')}</h3>
      <p>{t('cycleStartIntro')}</p>
      {next ? (
        <>
          <p>
            {t('cycleCarryCash')}:{' '}
            <strong>
              {group.currency} {next.cash}
            </strong>{' '}
            · {t('cycleSocialReserve')}:{' '}
            <strong>
              {group.currency} {next.social}
            </strong>{' '}
            {t('cycleMinorUnits')}
          </p>
          <form onSubmit={(e) => void save(e)}>
            <label>
              {t('cycleNewStart')}
              <input
                type="date"
                required
                min={next.earliest_start}
                value={value.starts_on}
                disabled={frozen}
                onChange={(e) =>
                  setValue({ ...value, starts_on: e.target.value })
                }
              />
            </label>
            <label>
              {t('cycleNewEnd')}
              <input
                type="date"
                required
                min={value.starts_on || next.earliest_start}
                value={value.ends_on}
                disabled={frozen}
                onChange={(e) =>
                  setValue({ ...value, ends_on: e.target.value })
                }
              />
            </label>
            <label>
              {t('cycleNewPrice')}
              <input
                inputMode="numeric"
                pattern="[1-9][0-9]*"
                maxLength={19}
                required
                value={value.share_price}
                disabled={frozen}
                onChange={(e) =>
                  setValue({ ...value, share_price: e.target.value })
                }
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                required
                disabled={frozen}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t('cycleConfirm')}
            </label>
            <button
              className="button"
              disabled={
                busy || !confirmed || (pending !== null && pending !== 'cycle')
              }
            >
              {t(pending === 'cycle' ? 'cycleRetry' : 'cycleStartButton')}
            </button>
          </form>
        </>
      ) : (
        <p>{t('cycleNotReady')}</p>
      )}
    </section>
  );
}

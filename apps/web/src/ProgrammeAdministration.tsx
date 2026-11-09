import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type AdminWorkspace,
  type AdminProgrammeWorkspace,
  type AdminProgrammeInput,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
export default function ProgrammeAdministration({
  workspace,
}: {
  workspace: AdminWorkspace;
}) {
  const [data, setData] = useState<AdminProgrammeWorkspace | null>(null),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef<AdminProgrammeInput | null>(null),
    device = useRef(newTransactionId());
  const current = data?.programmes.find((p) => p.id === selected);
  async function load() {
    const next = await api.adminProgrammes();
    setData(next);
    return next;
  }
  useEffect(() => {
    let active = true;
    void api
      .adminProgrammes()
      .then((v) => {
        if (active) setData(v);
      })
      .catch(() => {
        if (active) setError(t('programmeError'));
      });
    return () => {
      active = false;
    };
  }, []);
  async function send(input: AdminProgrammeInput) {
    pending.current = input;
    setBusy(true);
    setUncertain(true);
    setError('');
    setMessage('');
    try {
      const result = await api.adminProgramme(input);
      pending.current = null;
      setUncertain(false);
      await load();
      if (input.action === 'create') setSelected(result.id);
      setMessage(t('programmeSaved'));
    } catch (e) {
      if (e instanceof ClientError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        setUncertain(false);
      }
      setError(t('programmeSaveError'));
    } finally {
      setBusy(false);
    }
  }
  function submit(
    e: FormEvent<HTMLFormElement>,
    action: AdminProgrammeInput['action'],
  ) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      text = (key: string) => String(form.get(key) ?? '').trim();
    void send({
      request_id: newTransactionId(),
      device_id: device.current,
      action,
      programme_id: action === 'create' ? null : selected,
      group_id: action === 'link_group' ? text('group') : null,
      person_id: action === 'officer' ? text('person') : null,
      enabled: action === 'create' ? null : text('enabled') === 'true',
      name: action === 'create' ? text('name') : '',
      country_code: action === 'create' ? text('country').toUpperCase() : '',
      currency: action === 'create' ? text('currency') : '',
      time_zone: action === 'create' ? text('zone') : '',
      reason: text('reason'),
    });
  }
  const frozen = busy || uncertain;
  const reason = (id: string) => (
    <div className="form-group">
      <label htmlFor={id}>{t('programmeReason')}</label>
      <textarea
        id={id}
        name="reason"
        required
        minLength={5}
        maxLength={500}
        disabled={frozen}
      />
    </div>
  );
  return (
    <section className="admin-card admin-wide programme-administration">
      <h2>{t('programmeAdmin')}</h2>
      <p>{t('programmePrivacy')}</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {uncertain && pending.current && (
        <button
          className="button"
          disabled={busy}
          onClick={() => void send(pending.current!)}
        >
          {t('programmeRetry')}
        </button>
      )}
      <details>
        <summary>{t('programmeCreate')}</summary>
        <form onSubmit={(e) => submit(e, 'create')}>
          <div className="form-group">
            <label htmlFor="programme-new-name">{t('programmeName')}</label>
            <input
              id="programme-new-name"
              name="name"
              required
              maxLength={200}
              disabled={frozen}
            />
          </div>
          <div className="form-group">
            <label htmlFor="programme-country">{t('programmeCountry')}</label>
            <input
              id="programme-country"
              name="country"
              pattern="[A-Za-z]{2}"
              required
              maxLength={2}
              disabled={frozen}
            />
          </div>
          <div className="form-group">
            <label htmlFor="programme-currency">
              {t('programmeDefaultCurrency')}
            </label>
            <select
              id="programme-currency"
              name="currency"
              required
              disabled={frozen}
              defaultValue=""
            >
              <option value="">{t('adminChooseCurrency')}</option>
              {workspace.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
          <p>{t('programmeCurrencyHelp')}</p>
          <div className="form-group">
            <label htmlFor="programme-zone">{t('programmeZone')}</label>
            <input
              id="programme-zone"
              name="zone"
              required
              maxLength={100}
              disabled={frozen}
            />
          </div>
          {reason('programme-create-reason')}
          <button className="button primary" disabled={frozen}>
            {t('programmeCreate')}
          </button>
        </form>
      </details>
      <div className="form-group">
        <label htmlFor="programme-admin-select">{t('programmeChoose')}</label>
        <select
          id="programme-admin-select"
          disabled={frozen}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setMessage('');
          }}
        >
          <option value="">{t('programmeChoose')}</option>
          {data?.programmes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {current && (
        <>
          <h3>{t('programmeLinks')}</h3>
          <ul>
            {current.groups.map((id) => (
              <li key={id}>
                {workspace.groups.find((g) => g.id === id)?.name ?? id}
              </li>
            ))}
          </ul>
          <p>{t('programmeLinkHelp')}</p>
          <form onSubmit={(e) => submit(e, 'link_group')}>
            <div className="form-group">
              <label htmlFor="programme-group">{t('programmeGroup')}</label>
              <select
                id="programme-group"
                name="group"
                required
                disabled={frozen}
                defaultValue=""
              >
                <option value="">{t('programmeGroup')}</option>
                {workspace.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="programme-link-action">
                {t('adminRoleAction')}
              </label>
              <select
                id="programme-link-action"
                name="enabled"
                disabled={frozen}
              >
                <option value="true">{t('programmeLink')}</option>
                <option value="false">{t('programmeUnlink')}</option>
              </select>
            </div>
            {reason('programme-link-reason')}
            <button className="button primary" disabled={frozen}>
              {t('adminSaveSettings')}
            </button>
          </form>
          <h3>{t('programmeOfficers')}</h3>
          {!current.officers.length ? (
            <p>{t('programmeNoOfficers')}</p>
          ) : (
            <ul>
              {current.officers.map((id) => (
                <li key={id}>
                  {workspace.people.find((p) => p.id === id)?.name ?? id}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => submit(e, 'officer')}>
            <div className="form-group">
              <label htmlFor="programme-officer">{t('programmeStaff')}</label>
              <select
                id="programme-officer"
                name="person"
                required
                disabled={frozen}
                defaultValue=""
              >
                <option value="">{t('programmeStaff')}</option>
                {workspace.people
                  .filter(
                    (p) => p.staff_ready || current.officers.includes(p.id),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="programme-officer-action">
                {t('adminRoleAction')}
              </label>
              <select
                id="programme-officer-action"
                name="enabled"
                disabled={frozen}
              >
                <option value="true">{t('programmeAssign')}</option>
                <option value="false">{t('programmeRevoke')}</option>
              </select>
            </div>
            {reason('programme-officer-reason')}
            <button className="button primary" disabled={frozen}>
              {t('adminSaveRole')}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

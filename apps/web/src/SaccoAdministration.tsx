import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type AdminWorkspace,
  type SaccoSetup,
} from '@yapesa/api-client';
import { saccoText as s } from '@yapesa/i18n';
import './sacco.css';
type Workspace = Awaited<ReturnType<typeof api.saccoAdministration>>;
export default function SaccoAdministration({
  workspace,
}: {
  workspace: AdminWorkspace;
}) {
  const [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<SaccoSetup | null>(null),
    [name, setName] = useState(''),
    [country, setCountry] = useState(''),
    [currency, setCurrency] = useState(''),
    [zone, setZone] = useState(''),
    [instance, setInstance] = useState(''),
    [tenant, setTenant] = useState(''),
    [reason, setReason] = useState(''),
    [org, setOrg] = useState(''),
    [person, setPerson] = useState(''),
    [role, setRole] = useState<
      'manager' | 'accountant' | 'loan_officer' | 'teller' | 'field_officer'
    >('manager'),
    [enabled, setEnabled] = useState(true);
  const [engineUser, setEngineUser] = useState(''),
    [engineName, setEngineName] = useState('');
  const frozen = busy || !!pending;
  useEffect(() => {
    let active = true;
    void api
      .saccoAdministration()
      .then((v) => {
        if (active) setData(v);
      })
      .catch(() => {
        if (active) setError(s.error);
      });
    return () => {
      active = false;
    };
  }, []);
  async function send(command: SaccoSetup) {
    setBusy(true);
    setError('');
    try {
      await api.saccoSetup(command);
      setPending(null);
      setNotice(s.registered);
      setData(await api.saccoAdministration());
    } catch (error) {
      if (
        error instanceof ClientError &&
        error.status >= 400 &&
        error.status < 500
      )
        setPending(null);
      setError(s.error);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent, action: 'create' | 'role') {
    e.preventDefault();
    const command: SaccoSetup = {
      request_id: newTransactionId(),
      device_id: newTransactionId(),
      action,
      reason,
      ...(action === 'create'
        ? { name, country, currency, zone, instance, tenant }
        : { org, person, role, enabled }),
    };
    setPending(command);
    setNotice('');
    await send(command);
  }
  return (
    <section className="admin-card sacco-admin" aria-label={s.setup}>
      <h2>{s.setup}</h2>
      <p>{s.controlHelp}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="saved-confirmation" role="status">
          {notice}
        </p>
      )}
      {data && !data.instances.length && <p>{s.noConnection}</p>}
      <div className="sacco-field-grid">
        <form
          aria-label={s.newSacco}
          onSubmit={(e) => void submit(e, 'create')}
        >
          <h3>{s.newSacco}</h3>
          <label>
            SACCO {s.name}
            <input
              required
              value={name}
              disabled={frozen}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            SACCO {s.country}
            <input
              required
              value={country}
              pattern="[A-Z]{2}"
              maxLength={2}
              disabled={frozen}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            SACCO {s.currency}
            <select
              required
              value={currency}
              disabled={frozen}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="">{s.select}</option>
              {workspace.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            SACCO {s.zone}
            <input
              required
              value={zone}
              disabled={frozen}
              onChange={(e) => setZone(e.target.value)}
            />
          </label>
          <label>
            {s.instance}
            <select
              required
              value={instance}
              disabled={frozen}
              onChange={(e) => setInstance(e.target.value)}
            >
              <option value="">{s.select}</option>
              {data?.instances.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label>
            {s.tenant}
            <input
              required
              value={tenant}
              pattern="[a-z][a-z0-9_-]{0,62}"
              disabled={frozen}
              onChange={(e) => setTenant(e.target.value)}
            />
          </label>
          <label>
            SACCO {s.reason}
            <input
              required
              value={reason}
              disabled={frozen}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={frozen || !data?.instances.length}
          >
            {s.newSacco}
          </button>
        </form>
        <form aria-label={s.setRole} onSubmit={(e) => void submit(e, 'role')}>
          <h3>{s.setRole}</h3>
          <label>
            {s.choose}
            <select
              required
              value={org}
              disabled={frozen}
              onChange={(e) => setOrg(e.target.value)}
            >
              <option value="">{s.select}</option>
              {data?.saccos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            SACCO {s.person}
            <select
              required
              value={person}
              disabled={frozen}
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">{s.select}</option>
              {workspace.people
                .filter((p) => p.staff_ready)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            SACCO {s.role}
            <select
              value={role}
              disabled={frozen}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              {[
                'manager',
                'accountant',
                'loan_officer',
                'teller',
                'field_officer',
              ].map((key) => (
                <option key={key} value={key}>
                  {key.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            SACCO {s.enabled}
            <input
              type="checkbox"
              checked={enabled}
              disabled={frozen}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </label>
          <label>
            SACCO {s.reason}
            <input
              required
              value={reason}
              disabled={frozen}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="button" disabled={frozen}>
            {s.setRole}
          </button>
        </form>
      </div>
      <form
        aria-label={s.assignIdentity}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const body = {
            request_id: newTransactionId(),
            device_id: newTransactionId(),
            person,
            user: engineUser,
            username: engineName,
            reason,
          };
          void api
            .saccoAssignIdentity(org, body)
            .then(() => {
              setNotice(s.registered);
              return api.saccoAdministration();
            })
            .then(setData)
            .catch(() => setError(s.error))
            .finally(() => setBusy(false));
        }}
      >
        <h3>{s.assignIdentity}</h3>
        <p>{s.linkHelp}</p>
        <div className="sacco-field-grid">
          <label>
            {s.choose}
            <select
              required
              disabled={frozen}
              value={org}
              onChange={(e) => setOrg(e.target.value)}
            >
              <option value="">{s.select}</option>
              {data?.saccos.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            SACCO {s.person}
            <select
              required
              disabled={frozen}
              value={person}
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">{s.select}</option>
              {workspace.people
                .filter((p) => p.staff_ready)
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {s.engineUser}
            <input
              required
              pattern="[1-9][0-9]{0,18}"
              value={engineUser}
              disabled={frozen}
              onChange={(e) => setEngineUser(e.target.value)}
            />
          </label>
          <label>
            {s.username}
            <input
              required
              value={engineName}
              disabled={frozen}
              maxLength={100}
              onChange={(e) => setEngineName(e.target.value)}
            />
          </label>
          <label>
            SACCO {s.reason}
            <input
              required
              value={reason}
              disabled={frozen}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <button className="button" disabled={frozen}>
          {s.assignIdentity}
        </button>
      </form>
      {pending && (
        <div className="sacco-pending">
          <p>
            {s.reference}: {pending.request_id}
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() => void send(pending)}
          >
            {s.retry}
          </button>
        </div>
      )}
      {!!data?.staff.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{s.name}</th>
                <th>{s.role}</th>
                <th>{s.username}</th>
              </tr>
            </thead>
            <tbody>
              {data.staff
                .filter((row) => !org || row.organisation_id === org)
                .map((row) => (
                  <tr
                    key={`${row.organisation_id}-${row.person_id}-${row.role}`}
                  >
                    <td>{row.name}</td>
                    <td>{row.role.replaceAll('_', ' ')}</td>
                    <td>{row.engine_username ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

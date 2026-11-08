import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type AdminWorkspace,
  type StaffInviteInput,
  type StaffWorkspace,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';

export default function StaffInvitations({
  workspace,
  onChanged,
}: {
  workspace: AdminWorkspace;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<StaffWorkspace | null>(null);
  const [org, setOrg] = useState('');
  const [person, setPerson] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffInviteInput['role']>('secretary');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const command = useRef<StaffInviteInput | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .staffWorkspace()
      .then((value) => {
        if (alive) setData(value);
      })
      .catch(() => {
        if (alive) setError(t('staffError'));
      });
    return () => {
      alive = false;
    };
  }, []);
  async function refresh() {
    setData(await api.staffWorkspace());
    await onChanged();
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    command.current ??= {
      request_id: newTransactionId(),
      organisation_id: org,
      person_id: person || null,
      name: person ? '' : name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      role,
      reason: reason.trim(),
    };
    setBusy(true);
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api.staffInvite(command.current);
      command.current = null;
      setPending(false);
      setName('');
      setPhone('');
      setEmail('');
      setPerson('');
      setReason('');
      setNotice(t('staffSaved'));
      await refresh();
    } catch (error) {
      if (
        error instanceof ClientError &&
        (error.status === 400 || error.code === 'INVALID_STAFF_INVITATION')
      ) {
        command.current = null;
        setPending(false);
        setError(t('staffInvalid'));
      } else setError(t('staffPending'));
    } finally {
      setBusy(false);
    }
  }
  async function retry(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.staffInviteRetry(id);
      setNotice(t('staffSaved'));
      await refresh();
    } catch {
      setError(t('staffError'));
    } finally {
      setBusy(false);
    }
  }
  const frozen = busy || pending;
  return (
    <section className="admin-card" aria-label={t('staffTitle')}>
      <h2>{t('staffTitle')}</h2>
      <p>{t('staffHelp')}</p>
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
      <form onSubmit={(event) => void create(event)}>
        <div className="form-group">
          <label htmlFor="staff-group">{t('staffGroup')}</label>
          <select
            id="staff-group"
            required
            disabled={frozen}
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          >
            <option value="">{t('adminChooseGroup')}</option>
            {workspace.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="staff-person">{t('staffPerson')}</label>
          <select
            id="staff-person"
            disabled={frozen}
            value={person}
            onChange={(e) => {
              const value = workspace.people.find(
                (p) => p.id === e.target.value,
              );
              setPerson(e.target.value);
              setPhone(value?.phone ?? '');
            }}
          >
            <option value="">{t('staffNewPerson')}</option>
            {workspace.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.phone ? ` · ${p.phone}` : ''}
              </option>
            ))}
          </select>
        </div>
        {!person && (
          <div className="form-group">
            <label htmlFor="staff-name">{t('staffName')}</label>
            <input
              id="staff-name"
              required
              maxLength={150}
              disabled={frozen}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <div className="form-group">
          <label htmlFor="staff-phone">{t('staffPhone')}</label>
          <input
            id="staff-phone"
            type="tel"
            required
            pattern="\+[1-9][0-9]{6,14}"
            disabled={frozen || Boolean(person)}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+256…"
          />
        </div>
        <div className="form-group">
          <label htmlFor="staff-email">{t('staffEmail')}</label>
          <input
            id="staff-email"
            type="email"
            required
            maxLength={254}
            disabled={frozen}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p>{t('staffEmailHelp')}</p>
        </div>
        <div className="form-group">
          <label htmlFor="staff-role">{t('staffRole')}</label>
          <select
            id="staff-role"
            disabled={frozen}
            value={role}
            onChange={(e) =>
              setRole(e.target.value as StaffInviteInput['role'])
            }
          >
            <option value="secretary">{t('adminRoleSecretary')}</option>
            <option value="treasurer">{t('adminRoleTreasurer')}</option>
            <option value="chair">{t('adminRoleChair')}</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="staff-reason">{t('staffReason')}</label>
          <textarea
            id="staff-reason"
            required
            maxLength={500}
            disabled={frozen}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <button className="button primary" disabled={busy} type="submit">
          {t(pending ? 'staffRetry' : 'staffCreate')}
        </button>
      </form>
      {data?.invitations.map((item) => (
        <article className="admin-card" key={item.id}>
          <h3>{item.name}</h3>
          <p>
            {item.phone} ·{' '}
            {workspace.groups.find((g) => g.id === item.organisation_id)?.name}{' '}
            · {item.role}
          </p>
          <p>
            {t(
              item.cancelled
                ? 'staffCancelled'
                : item.activated
                  ? 'staffActive'
                  : item.account_created
                    ? 'staffWaiting'
                    : 'staffUnfinished',
            )}
          </p>
          {!item.cancelled && !item.account_created && (
            <button
              className="button"
              disabled={busy || pending}
              onClick={() => void retry(item.id)}
            >
              {t('staffRetry')}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}

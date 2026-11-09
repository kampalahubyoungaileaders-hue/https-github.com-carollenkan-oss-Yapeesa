import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type AdminWorkspace,
  type AdminGroupInput,
  type AdminSettingsInput,
} from '@yapesa/api-client';
import { t } from '@yapesa/i18n';
import NewCycle from './NewCycle';
import StaffInvitations from './StaffInvitations';
import AuthenticatorRecovery from './AuthenticatorRecovery';

type Group = AdminWorkspace['groups'][number];
type Command = { request_id: string; device_id: string };
type Settings = Omit<AdminSettingsInput, keyof Command>;
const roleKeys = {
  member: 'adminRoleMember',
  secretary: 'adminRoleSecretary',
  treasurer: 'adminRoleTreasurer',
  chair: 'adminRoleChair',
} as const;
type GroupRole = keyof typeof roleKeys;

function ConfigurationForm({
  initial,
  currencies,
  busy,
  locked,
  retry,
  operation,
  pending,
  submit,
}: {
  initial?: Group;
  currencies: AdminWorkspace['currencies'];
  busy: boolean;
  locked: boolean;
  retry: boolean;
  operation: string;
  pending: string | null;
  submit: (value: Omit<AdminGroupInput, keyof Command>) => Promise<boolean>;
}) {
  const blank = {
    name: '',
    country_code: '',
    currency: '',
    time_zone: '',
    max_shares: '',
    starts_on: '',
    ends_on: '',
    share_price: '',
  };
  const [value, setValue] = useState(() =>
    initial
      ? {
          name: initial.name,
          country_code: initial.country_code,
          currency: initial.currency,
          time_zone: initial.time_zone,
          max_shares: initial.max_shares,
          starts_on: initial.cycle?.starts_on ?? '',
          ends_on: initial.cycle?.ends_on ?? '',
          share_price: initial.cycle?.share_price ?? '',
        }
      : blank,
  );
  const frozen = busy || locked || pending !== null;
  const prefix = initial ? `settings-${initial.id}` : 'new-group';
  function field(
    key: keyof typeof value,
    label: string,
    props: {
      type?: string;
      pattern?: string;
      maxLength?: number;
      readOnly?: boolean;
    } = {},
  ) {
    return (
      <div className="form-group">
        <label htmlFor={`${prefix}-${key}`}>{label}</label>
        <input
          id={`${prefix}-${key}`}
          required
          disabled={frozen}
          {...props}
          value={value[key]}
          onChange={(e) =>
            setValue({
              ...value,
              [key]:
                key === 'country_code'
                  ? e.target.value.toUpperCase()
                  : e.target.value,
            })
          }
        />
      </div>
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if ((await submit({ ...value, name: value.name.trim() })) && !initial)
      setValue(blank);
  }
  return (
    <form onSubmit={(event) => void save(event)}>
      {locked && (
        <p className="dialog-description">{t('adminSettingsLocked')}</p>
      )}
      {field('name', t('adminGroupName'), { maxLength: 200 })}
      {!initial && (
        <>
          {field('country_code', t('adminCountry'), {
            pattern: '[A-Z]{2}',
            maxLength: 2,
          })}
          <div className="form-group">
            <label htmlFor={`${prefix}-currency`}>{t('adminCurrency')}</label>
            <select
              id={`${prefix}-currency`}
              required
              disabled={frozen}
              value={value.currency}
              onChange={(e) => setValue({ ...value, currency: e.target.value })}
            >
              <option value="">{t('adminChooseCurrency')}</option>
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}
                </option>
              ))}
            </select>
          </div>
          {field('time_zone', t('adminTimeZone'), { maxLength: 100 })}
          <p className="dialog-description">{t('adminZoneHelp')}</p>
        </>
      )}
      {field('max_shares', t('adminMaxShares'), {
        pattern: '[1-9][0-9]{0,18}',
      })}
      {field('starts_on', t('adminCycleStart'), { type: 'date' })}
      {field('ends_on', t('adminCycleEnd'), { type: 'date' })}
      {field(
        'share_price',
        `${t('adminSharePrice')}${value.currency ? ` (${value.currency})` : ''}`,
        { pattern: '[1-9][0-9]{0,18}', readOnly: Boolean(initial?.cycle) },
      )}
      <p className="dialog-description">{t('adminPriceHelp')}</p>
      {initial && <p className="dialog-description">{t('adminFixedPrice')}</p>}
      <button
        className="button primary"
        type="submit"
        disabled={busy || locked || (pending !== null && pending !== operation)}
      >
        {retry
          ? t('adminRetry')
          : t(initial ? 'adminSaveSettings' : 'adminCreateGroup')}
      </button>
    </form>
  );
}

export default function Administration({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<AdminWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState('');
  const [memberKind, setMemberKind] = useState('new');
  const [memberName, setMemberName] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [existing, setExisting] = useState('');
  const [rolePerson, setRolePerson] = useState('');
  const [role, setRole] = useState<GroupRole>('member');
  const [enabled, setEnabled] = useState(true);
  const command = useRef<{ key: string; id: string } | null>(null);
  const device = useRef(newTransactionId());
  const group = data?.groups.find((item) => item.id === selected);
  const frozen = busy || pending !== null;
  function message(err: unknown) {
    const code = err instanceof ClientError ? err.code : '';
    return t(
      code === 'INVALID_ADMIN_REQUEST'
        ? 'adminInvalid'
        : code === 'DUPLICATE_REFERENCE'
          ? 'adminDuplicate'
          : code === 'PERMISSION_DENIED' || code === 'MFA_REQUIRED'
            ? 'permissionError'
            : code === 'AUTH_REQUIRED' || code === 'INVALID_CREDENTIALS'
              ? 'sessionExpired'
              : code === 'TOO_MANY_ATTEMPTS'
                ? 'rateLimited'
                : 'connectionError',
    );
  }
  async function load() {
    const value = await api.adminWorkspace();
    setData(value);
    setSelected((current) =>
      value.groups.some((item) => item.id === current)
        ? current
        : (value.groups[0]?.id ?? ''),
    );
  }
  useEffect(() => {
    let cancelled = false;
    api
      .adminWorkspace()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setSelected(value.groups[0]?.id ?? '');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(message(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function mutate(
    operation: string,
    input: object,
    execute: (meta: Command) => Promise<{ id: string }>,
  ) {
    const key = JSON.stringify({ operation, input });
    if (command.current && command.current.key !== key) {
      setError(t('adminPending'));
      return null;
    }
    command.current ??= { key, id: newTransactionId() };
    setBusy(true);
    setPending(operation);
    setError('');
    setNotice('');
    try {
      const result = await execute({
        request_id: command.current.id,
        device_id: device.current,
      });
      command.current = null;
      setPending(null);
      setNotice(t('adminSaved'));
      try {
        await load();
      } catch {
        setError(t('adminSavedRefresh'));
      }
      return result;
    } catch (err) {
      if (err instanceof ClientError && err.status >= 400 && err.status < 500) {
        command.current = null;
        setPending(null);
      }
      setError(message(err));
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!group) return;
    const input = {
      existing_person: memberKind === 'existing' ? existing : null,
      name: memberKind === 'new' ? memberName.trim() : '',
      phone:
        memberKind === 'new' && memberPhone.trim() ? memberPhone.trim() : null,
    };
    if (
      await mutate('member', input, (meta) =>
        api.adminAddMember(group.id, { ...meta, ...input }),
      )
    ) {
      setMemberName('');
      setMemberPhone('');
      setExisting('');
    }
  }
  async function saveRole(event: FormEvent) {
    event.preventDefault();
    if (!group) return;
    const input = { person_id: rolePerson, role, enabled };
    await mutate('role', input, (meta) =>
      api.adminRole(group.id, { ...meta, ...input }),
    );
  }
  function personSelect(
    id: string,
    label: string,
    value: string,
    update: (value: string) => void,
  ) {
    return (
      <div className="form-group">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          required
          disabled={frozen}
          value={value}
          onChange={(e) => update(e.target.value)}
        >
          <option value="">{t('adminChoosePerson')}</option>
          {data?.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {person.phone ? ` · ${person.phone}` : ''}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="admin-console">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Yapesa</p>
          <h1>{t('administration')}</h1>
          <p>{t('adminDescription')}</p>
        </div>
        <div className="heading-actions">
          <button className="button" disabled={frozen} onClick={onBack}>
            {t('adminBack')}
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              setError('');
              void load().catch((err) => setError(message(err)));
            }}
          >
            {t('adminRefresh')}
          </button>
        </div>
      </header>
      {loading && <p role="status">{t('loadingRecords')}</p>}
      {busy && <p role="status">{t('connectingSecurely')}</p>}
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
      {pending && !busy && (
        <p className="form-error" role="status">
          {t('adminPending')}
        </p>
      )}
      {data && (
        <>
          <StaffInvitations workspace={data} onChanged={load} />
          <AuthenticatorRecovery />
          <div className="admin-grid">
            <section className="admin-card" aria-label={t('adminCreateGroup')}>
              <h2>{t('adminCreateGroup')}</h2>
              <ConfigurationForm
                currencies={data.currencies}
                busy={busy}
                locked={false}
                retry={pending === 'create'}
                operation="create"
                pending={pending}
                submit={async (input) => {
                  const result = await mutate('create', input, (meta) =>
                    api.adminCreateGroup({ ...input, ...meta }),
                  );
                  if (result) setSelected(result.id);
                  return result !== null;
                }}
              />
            </section>
            <section className="admin-card" aria-label={t('adminManageGroup')}>
              <h2>{t('adminManageGroup')}</h2>
              <div className="form-group">
                <label htmlFor="admin-group">{t('adminChooseGroup')}</label>
                <select
                  id="admin-group"
                  disabled={frozen}
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setRolePerson('');
                    setExisting('');
                  }}
                >
                  <option value="">{t('adminChooseGroup')}</option>
                  {data.groups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              {!group && <p>{t('adminNoGroups')}</p>}
              {group && (
                <>
                  <p>
                    {group.country_code} · {group.currency} · {group.time_zone}
                  </p>
                  <NewCycle
                    key={`new-cycle-${group.id}-${group.cycle?.starts_on ?? 'closed'}`}
                    group={group}
                    busy={busy}
                    pending={pending}
                    submit={async (input) =>
                      (await mutate('cycle', input, (meta) =>
                        api.adminStartCycle(group.id, { ...input, ...meta }),
                      )) !== null
                    }
                  />
                  <h3>{t('adminSettings')}</h3>
                  <ConfigurationForm
                    key={`settings-${group.id}-${group.cycle?.starts_on ?? 'closed'}`}
                    initial={group}
                    currencies={data.currencies}
                    busy={busy}
                    locked={group.configuration_locked}
                    retry={pending === 'settings'}
                    operation="settings"
                    pending={pending}
                    submit={async (input) => {
                      const settings: Settings = {
                        name: input.name,
                        max_shares: input.max_shares,
                        starts_on: input.starts_on,
                        ends_on: input.ends_on,
                        share_price: input.share_price,
                      };
                      return (
                        (await mutate('settings', settings, (meta) =>
                          api.adminSettings(group.id, { ...settings, ...meta }),
                        )) !== null
                      );
                    }}
                  />
                </>
              )}
            </section>
          </div>
          {group && (
            <div className="admin-grid">
              <section className="admin-card" aria-label={t('adminAddMember')}>
                <h2>{t('adminAddMember')}</h2>
                <p>{t('adminMemberHelp')}</p>
                <form onSubmit={(event) => void addMember(event)}>
                  <div className="form-group">
                    <label htmlFor="admin-member-kind">
                      {t('adminMemberKind')}
                    </label>
                    <select
                      id="admin-member-kind"
                      disabled={frozen}
                      value={memberKind}
                      onChange={(e) => setMemberKind(e.target.value)}
                    >
                      <option value="new">{t('adminNewPerson')}</option>
                      <option value="existing">
                        {t('adminExistingPerson')}
                      </option>
                    </select>
                  </div>
                  {memberKind === 'existing' ? (
                    personSelect(
                      'admin-existing-person',
                      t('adminExistingPerson'),
                      existing,
                      setExisting,
                    )
                  ) : (
                    <>
                      <div className="form-group">
                        <label htmlFor="admin-member-name">
                          {t('adminPersonName')}
                        </label>
                        <input
                          id="admin-member-name"
                          required
                          maxLength={150}
                          disabled={frozen}
                          value={memberName}
                          onChange={(e) => setMemberName(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="admin-member-phone">
                          {t('adminOptionalPhone')}
                        </label>
                        <input
                          id="admin-member-phone"
                          type="tel"
                          pattern="\+[1-9][0-9]{6,14}"
                          disabled={frozen}
                          value={memberPhone}
                          onChange={(e) => setMemberPhone(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  <button
                    className="button primary"
                    type="submit"
                    disabled={
                      busy || (pending !== null && pending !== 'member')
                    }
                  >
                    {pending === 'member'
                      ? t('adminRetry')
                      : t('adminAddMember')}
                  </button>
                </form>
              </section>
              <section className="admin-card" aria-label={t('adminRoles')}>
                <h2>{t('adminRoles')}</h2>
                <p>{t('adminStaffHelp')}</p>
                <form onSubmit={(event) => void saveRole(event)}>
                  {personSelect(
                    'admin-role-person',
                    t('adminRolePerson'),
                    rolePerson,
                    setRolePerson,
                  )}
                  <div className="form-group">
                    <label htmlFor="admin-role">{t('adminRole')}</label>
                    <select
                      id="admin-role"
                      disabled={frozen}
                      value={role}
                      onChange={(e) => setRole(e.target.value as GroupRole)}
                    >
                      {(Object.keys(roleKeys) as GroupRole[]).map((key) => (
                        <option key={key} value={key}>
                          {t(roleKeys[key])}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="admin-role-action">
                      {t('adminRoleAction')}
                    </label>
                    <select
                      id="admin-role-action"
                      disabled={frozen}
                      value={enabled ? 'grant' : 'revoke'}
                      onChange={(e) => setEnabled(e.target.value === 'grant')}
                    >
                      <option value="grant">{t('adminGrant')}</option>
                      <option value="revoke">{t('adminRevoke')}</option>
                    </select>
                  </div>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={busy || (pending !== null && pending !== 'role')}
                  >
                    {pending === 'role' ? t('adminRetry') : t('adminSaveRole')}
                  </button>
                </form>
              </section>
              <section className="admin-card admin-wide">
                <h2>{t('adminCurrentRoles')}</h2>
                {group.memberships.length === 0 ? (
                  <p>{t('adminNoMembers')}</p>
                ) : (
                  <div className="admin-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('adminPersonName')}</th>
                          <th>{t('adminRole')}</th>
                          <th>{t('authenticator')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.memberships.map((membership) => {
                          const person = data.people.find(
                            (item) => item.id === membership.person_id,
                          );
                          return (
                            <tr
                              key={`${membership.person_id}-${membership.role}`}
                            >
                              <td>{person?.name}</td>
                              <td>
                                {t(
                                  roleKeys[membership.role as GroupRole] ??
                                    'adminRoleMember',
                                )}
                              </td>
                              <td>
                                {t(
                                  person?.staff_ready
                                    ? 'adminStaffReady'
                                    : 'adminMemberOnly',
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ClientError,
  newTransactionId,
  type SaccoCatalog,
  type SaccoJson,
  type SaccoList,
  type SaccoSummary,
  type SaccoCommand,
  type SaccoField,
} from '@yapesa/api-client';
import { saccoText as s, saccoFieldLabels } from '@yapesa/i18n';
import { exportRows } from './workspace';
import './sacco.css';
function downloadCsv(name: string, rows: readonly (readonly string[])[]) {
  const url = URL.createObjectURL(
    new Blob([exportRows(rows)], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
function record(v: SaccoJson | undefined): Record<string, SaccoJson> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function text(v: SaccoJson | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? '✓' : '—';
  if (Array.isArray(v)) {
    if (
      v.length === 3 &&
      v.every((n) => typeof n === 'string' && /^\d+$/.test(n))
    )
      return `${v[0]}-${v[1]!.toString().padStart(2, '0')}-${v[2]!.toString().padStart(2, '0')}`;
    return v.map(text).join(', ');
  }
  const r = record(v);
  return text(
    r['displayLabel'] ??
      r['displayName'] ??
      r['name'] ??
      r['value'] ??
      r['code'] ??
      r['id'],
  );
}
function rowsOf(v: SaccoJson | null): Record<string, SaccoJson>[] {
  const data = Array.isArray(v) ? v : record(v ?? undefined)['pageItems'];
  return Array.isArray(data) ? data.map(record) : [];
}
function errorText(error: unknown) {
  if (error instanceof ClientError) {
    if (error.fields?.length)
      return (
        s.error +
        ' ' +
        error.fields
          .map((key) => saccoFieldLabels[key] ?? key.replace(/([A-Z])/g, ' $1'))
          .join(', ')
      );
    if (error.code === 'FINERACT_OUTCOME_UNCERTAIN') return s.uncertain;
    if (error.code === 'FINERACT_NOT_CONFIGURED') return s.unavailable;
    if (error.code === 'FINERACT_APPROVAL_CONTROLS_REQUIRED')
      return s.controlHelp;
    if (
      error.code === 'FINERACT_RELINK_REQUIRED' ||
      error.code === 'FINERACT_CREDENTIALS_REJECTED'
    )
      return s.linkHelp;
  }
  return s.error;
}
const optionsByField: Record<string, string[]> = {
  productId: ['productOptions'],
  officeId: ['officeOptions', 'allowedOffices'],
  fieldOfficerId: ['fieldOfficerOptions', 'staffOptions'],
  paymentTypeId: ['paymentTypeOptions'],
  amortizationType: ['amortizationTypeOptions'],
  interestType: ['interestTypeOptions'],
  interestCalculationPeriodType: ['interestCalculationPeriodTypeOptions'],
  repaymentFrequencyType: [
    'repaymentFrequencyTypeOptions',
    'termFrequencyTypeOptions',
  ],
  loanTermFrequencyType: ['termFrequencyTypeOptions'],
  transactionProcessingStrategyCode: ['transactionProcessingStrategyOptions'],
  interestCompoundingPeriodType: ['interestCompoundingPeriodTypeOptions'],
  interestPostingPeriodType: ['interestPostingPeriodTypeOptions'],
  interestCalculationType: ['interestCalculationTypeOptions'],
  interestCalculationDaysInYearType: [
    'interestCalculationDaysInYearTypeOptions',
  ],
  accountingRule: ['accountingRuleOptions'],
};
function fieldOptions(field: SaccoField, template: Record<string, SaccoJson>) {
  for (const key of optionsByField[field.key] ?? []) {
    const v = template[key];
    if (Array.isArray(v))
      return v
        .map(record)
        .map((r) => ({
          value: text(r[field.key.endsWith('Code') ? 'code' : 'id']),
          label: text(r['name'] ?? r['value'] ?? r['displayName'] ?? r['code']),
        }))
        .filter((v) => v.value);
  }
  return [];
}
function Field({
  field,
  value,
  onChange,
  template,
  disabled,
}: {
  field: SaccoField;
  value: string;
  onChange: (v: string) => void;
  template: Record<string, SaccoJson>;
  disabled: boolean;
}) {
  const options = fieldOptions(field, template);
  return (
    <label>
      {field.label}
      {!field.required && <small> {s.optional}</small>}
      {field.type === 'boolean' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          disabled={disabled}
        >
          <option value="">{s.select}</option>
          <option value="true">✓</option>
          <option value="false">—</option>
        </select>
      ) : options.length ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          disabled={disabled}
        >
          <option value="">{s.select}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'date' ? 'date' : 'text'}
          inputMode={
            ['id', 'integer', 'decimal'].includes(field.type)
              ? 'decimal'
              : undefined
          }
          value={value}
          required={field.required}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      )}
    </label>
  );
}
function DataTable({
  rows,
  onOpen,
}: {
  rows: Record<string, SaccoJson>[];
  onOpen?: (id: string) => void;
}) {
  const columns: [string, string, (r: Record<string, SaccoJson>) => string][] =
    [
      ['id', s.id, (r) => text(r['id'])],
      [
        'name',
        s.name,
        (r) =>
          text(
            r['displayName'] ??
              r['clientName'] ??
              r['name'] ??
              r['reportName'] ??
              r['officeName'],
          ),
      ],
      [
        'account',
        s.account,
        (r) =>
          text(
            r['accountNo'] ??
              r['glCode'] ??
              record(r['accountData'])['accountNo'],
          ),
      ],
      [
        'product',
        s.product,
        (r) =>
          text(
            r['savingsProductName'] ?? r['loanProductName'] ?? r['productName'],
          ),
      ],
      ['status', s.status, (r) => text(r['status'])],
      ['type', s.type, (r) => text(r['type'] ?? r['transactionType'])],
      ['currency', s.currency, (r) => text(record(r['currency'])['code'])],
      ['amount', s.amount, (r) => text(r['amount'])],
      [
        'savingsTransaction',
        s.savingsTransaction,
        (r) => text(r['savingsTransactionId']),
      ],
      ['principal', s.principal, (r) => text(r['principalDue'])],
      ['interest', s.interest, (r) => text(r['interestDue'])],
      ['fees', s.fees, (r) => text(r['feeChargesDue'])],
      ['penalties', s.penalties, (r) => text(r['penaltyChargesDue'])],
      ['due', s.totalDue, (r) => text(r['totalDueForPeriod'])],
      ['paid', s.paid, (r) => text(r['totalPaidForPeriod'])],
      [
        'outstanding',
        s.outstanding,
        (r) => text(r['totalOutstandingForPeriod']),
      ],
      [
        'balance',
        s.balance,
        (r) =>
          text(record(r['summary'])['accountBalance'] ?? r['accountBalance']),
      ],
      [
        'date',
        s.date,
        (r) =>
          text(
            r['date'] ?? r['transactionDate'] ?? r['entryDate'] ?? r['dueDate'],
          ),
      ],
    ];
  const visible = columns.filter(([, , value]) =>
    rows.some((row) => value(row)),
  );
  if (!rows.length) return <p className="sacco-empty">{s.noRows}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {visible.map(([key, label]) => (
              <th key={key}>{label}</th>
            ))}
            {onOpen && <th>{s.actions}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={text(row['id']) || String(i)}>
              {visible.map(([key, , value]) => (
                <td key={key}>{value(row) || '—'}</td>
              ))}
              {onOpen && (
                <td>
                  {text(row['id']) && (
                    <button
                      className="text-button"
                      onClick={() => onOpen(text(row['id']))}
                    >
                      {s.open}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Detail({
  data,
  offset = 0,
  busy = false,
  onPage,
}: {
  data: SaccoJson;
  offset?: number;
  busy?: boolean;
  onPage?: (offset: number) => void;
}) {
  const r = record(data),
    summary = record(r['summary']),
    currency = text(record(r['currency'])['code']);
  const facts = [
    'accountNo',
    'displayName',
    'clientName',
    'name',
    'productName',
    'savingsProductName',
    'loanProductName',
    'status',
    'operation',
    'officeName',
    'mobileNo',
    'externalId',
  ];
  const nested = Object.entries(r).filter(
    ([key, value]) =>
      [
        'transactions',
        'purchasedShares',
        'dividends',
        'pageItems',
        'charges',
        'guarantors',
        'identifiers',
      ].includes(key) && Array.isArray(value),
  );
  const schedule = record(r['repaymentSchedule'])['periods'] ?? r['periods'];
  if (Array.isArray(schedule)) nested.push(['repaymentSchedule', schedule]);
  return (
    <>
      <dl className="sacco-facts">
        {facts
          .filter((key) => text(r[key]))
          .map((key) => (
            <div key={key}>
              <dt>
                {saccoFieldLabels[key] ??
                  (
                    {
                      accountNo: s.account,
                      displayName: s.member,
                      clientName: s.member,
                      productName: s.product,
                      savingsProductName: s.product,
                      loanProductName: s.product,
                      status: s.status,
                      officeName: 'Branch',
                    } as Record<string, string>
                  )[key] ??
                  key}
              </dt>
              <dd>{text(r[key])}</dd>
            </div>
          ))}
        {currency && (
          <div>
            <dt>{s.currency}</dt>
            <dd>{currency}</dd>
          </div>
        )}
      </dl>
      {Object.keys(record(r['values'])).length > 0 && (
        <dl className="sacco-facts">
          {Object.entries(record(r['values']))
            .flatMap(([key, value]) =>
              key === 'values' &&
              value &&
              typeof value === 'object' &&
              !Array.isArray(value)
                ? Object.entries(value)
                : [[key, value] as [string, SaccoJson]],
            )
            .filter(
              ([key]) =>
                !['locale', 'dateFormat', 'command_hash'].includes(key),
            )
            .map(([key, value]) => (
              <div key={key}>
                <dt>
                  {saccoFieldLabels[key] ?? key.replace(/([A-Z])/g, ' $1')}
                </dt>
                <dd>{text(value)}</dd>
              </div>
            ))}
        </dl>
      )}
      {Object.keys(summary).length > 0 && (
        <dl className="sacco-facts">
          {Object.entries(summary)
            .filter(([, v]) => typeof v === 'string')
            .map(([key, v]) => (
              <div key={key}>
                <dt>
                  {key
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/^./, (c) => c.toUpperCase())}
                </dt>
                <dd>{text(v)}</dd>
              </div>
            ))}
        </dl>
      )}
      {nested.map(([key, v]) => (
        <section key={key}>
          <h3>
            {key === 'pageItems'
              ? s.dividendAllocations
              : key
                  .replace(/([A-Z])/g, ' $1')
                  .replace(/^./, (c) => c.toUpperCase())}
          </h3>
          <DataTable rows={(v as SaccoJson[]).map(record)} />
          {key === 'pageItems' && onPage && (
            <div className="sacco-paging">
              <span>
                {s.total}: {text(r['totalFilteredRecords'])}
              </span>
              <button
                className="button"
                disabled={busy || offset === 0}
                onClick={() => onPage(Math.max(0, offset - 50))}
              >
                {s.previous}
              </button>
              <button
                className="button"
                disabled={
                  busy ||
                  (v as SaccoJson[]).length < 50 ||
                  (/^\d+$/.test(text(r['totalFilteredRecords'])) &&
                    BigInt(offset + 50) >=
                      BigInt(text(r['totalFilteredRecords'])))
                }
                onClick={() => onPage(offset + 50)}
              >
                {s.next}
              </button>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
export default function SaccoWorkspace({
  choices,
  onBack,
  onSignOut,
}: {
  choices: SaccoList;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [org, setOrg] = useState(
      choices.find((c) => c.can_work)?.id ?? choices[0]?.id ?? '',
    ),
    [summary, setSummary] = useState<SaccoSummary | null>(null),
    [catalog, setCatalog] = useState<SaccoCatalog | null>(null),
    [resource, setResource] = useState('members'),
    [data, setData] = useState<SaccoJson | null>(null),
    [detail, setDetail] = useState<SaccoJson | null>(null),
    [selected, setSelected] = useState(''),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [office, setOffice] = useState(''),
    [dividendProduct, setDividendProduct] = useState(''),
    [detailOffset, setDetailOffset] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [action, setAction] = useState(''),
    [values, setValues] = useState<Record<string, string>>({}),
    [subRecord, setSubRecord] = useState(''),
    [template, setTemplate] = useState<Record<string, SaccoJson>>({}),
    [pending, setPending] = useState<SaccoCommand | null>(null),
    [message, setMessage] = useState(''),
    [preview, setPreview] = useState<SaccoJson | null>(null);
  const detailScope = useRef(''),
    detailSerial = useRef(0);
  const nextDetailScope = `${org}/${resource}/${dividendProduct}`;
  if (detailScope.current !== nextDetailScope) {
    detailScope.current = nextDetailScope;
    detailSerial.current++;
  }
  const chosen = choices.find((c) => c.id === org),
    definition = catalog?.resources.find((r) => r.id === resource),
    operations =
      catalog?.operations.filter((o) => o.resource === resource) ?? [],
    operation = operations.find((o) => o.id === action),
    rows = rowsOf(data),
    total = text(record(data ?? undefined)['totalFilteredRecords']);
  async function perform(job: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await job();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const scope = detailScope.current;
    const query: Record<string, string> = { offset: String(offset) };
    if (resource === 'dividends') {
      if (!/^[1-9]\d{0,18}$/.test(dividendProduct)) {
        setData(null);
        setDetail(null);
        return;
      }
      query['product'] = dividendProduct;
    }
    if (search && resource === 'members') query['search'] = search;
    if (resource === 'journals') {
      if (!from || !to || !office) {
        setData(null);
        return;
      }
      Object.assign(query, { from, to, office });
    }
    const result = await api.saccoRecords(org, resource, query);
    if (scope !== detailScope.current) return;
    setData(result);
    if (selected) await loadDetail(selected, detailOffset);
  }
  useEffect(() => {
    let active = true;
    setSummary(null);
    setCatalog(null);
    setData(null);
    setDetail(null);
    setSelected('');
    setDividendProduct('');
    setAction('');
    setPending(null);
    setError('');
    setBusy(true);
    void api
      .saccoSummary(org)
      .then(async (value) => {
        if (!active) return;
        setSummary(value);
        setUsername(value.expected_username ?? '');
        if (value.linked && value.configured) {
          const c = await api.saccoCatalog(org);
          if (active) {
            setCatalog(c);
            setResource(c.resources[0]?.id ?? 'members');
          }
        }
      })
      .catch((error) => {
        if (active) setError(errorText(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [org]);
  useEffect(() => {
    if (!catalog) return;
    let active = true;
    setData(null);
    setSelected('');
    setDetail(null);
    setAction('');
    setValues({});
    setPending(null);
    setMessage('');
    setPreview(null);
    setBusy(true);
    const query: Record<string, string> = { offset: String(offset) };
    if (resource === 'dividends') {
      if (!/^[1-9]\d{0,18}$/.test(dividendProduct)) {
        setBusy(false);
        return;
      }
      query['product'] = dividendProduct;
    }
    if (search && resource === 'members') query['search'] = search;
    if (resource === 'journals') {
      if (!from || !to || !office) {
        setBusy(false);
        return;
      }
      Object.assign(query, { from, to, office });
    }
    void api
      .saccoRecords(org, resource, query)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [
    org,
    resource,
    offset,
    search,
    from,
    to,
    office,
    dividendProduct,
    catalog,
  ]);
  useEffect(() => {
    if (!operation || !definition?.template) {
      setTemplate({});
      return;
    }
    let active = true;
    const query: Record<string, string> = { template: 'true' };
    if (values['clientId']) query['client'] = values['clientId'];
    if (values['productId']) query['product'] = values['productId'];
    void api
      .saccoRecords(org, resource, query)
      .then((v) => {
        if (active) setTemplate(record(v));
      })
      .catch(() => {
        if (active) setTemplate({});
      });
    return () => {
      active = false;
    };
  }, [
    org,
    resource,
    action,
    values['clientId'],
    values['productId'],
    definition?.template,
    operation,
  ]);
  async function loadDetail(id: string, pageOffset: number) {
    const scope = detailScope.current,
      serial = ++detailSerial.current;
    const result = await api.saccoRecords(org, resource, {
      record: id,
      ...(resource === 'dividends'
        ? { product: dividendProduct, offset: String(pageOffset) }
        : {}),
    });
    if (scope === detailScope.current && serial === detailSerial.current) {
      setDetail(result);
      setDetailOffset(pageOffset);
    }
  }
  async function open(id: string) {
    setSelected(id);
    setDetail(null);
    setDetailOffset(0);
    await perform(() => loadDetail(id, 0));
  }
  async function connect(e: FormEvent) {
    e.preventDefault();
    await perform(async () => {
      await api.saccoConnect(org, {
        username,
        password,
        device_id: newTransactionId(),
      });
      setPassword('');
      setSummary(await api.saccoSummary(org));
      setCatalog(await api.saccoCatalog(org));
    });
  }
  async function send(command: SaccoCommand) {
    let result;
    try {
      result = await api.saccoCommand(org, command);
    } catch (error) {
      if (
        error instanceof ClientError &&
        error.status >= 400 &&
        error.status < 500
      )
        setPending(null);
      throw error;
    }
    if (result.status === 'preview') {
      setPreview(result.data ?? null);
      setPending(null);
      return;
    }
    if (result.status === 'rejected') {
      setMessage(s.rejected);
      setPending(null);
      return;
    }
    setMessage(
      result.status === 'awaiting_approval'
        ? s.queued
        : result.status === 'approved'
          ? s.approved
          : result.status === 'uncertain'
            ? s.uncertain
            : s.confirmed,
    );
    setPending(null);
    await refresh();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!operation) return;
    const command: SaccoCommand = {
      request_id: newTransactionId(),
      operation: operation.id,
      values,
      ...(resource === 'approvals' && detail
        ? { review_hash: text(record(detail)['review_hash']) }
        : {}),
      ...(operation.target ? { record: selected } : {}),
      ...(operation.sub_target ? { sub_record: subRecord } : {}),
    };
    if (!operation.quote) setPending(command);
    setMessage('');
    await perform(() => send(command));
  }
  const formDisabled = busy || !!pending;
  return (
    <div className="sacco-workspace">
      <header className="sacco-header">
        <div>
          <span className="eyebrow">YAPESA</span>
          <h1>{s.title}</h1>
          <p>{chosen?.name}</p>
        </div>
        <div className="sacco-header-actions">
          <label>
            {s.choose}
            <select
              value={org}
              disabled={busy || !!pending}
              onChange={(e) => setOrg(e.target.value)}
            >
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button" onClick={onSignOut} disabled={busy}>
            {s.signOut}
          </button>
          <button className="button" onClick={onBack} disabled={busy}>
            {s.back}
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="success-banner" role="status">
          {message}
        </div>
      )}
      {!summary && busy && <p role="status">{s.loading}</p>}
      {summary && !summary.configured && (
        <section className="panel sacco-empty">
          <h2>{s.setup}</h2>
          <p>{s.unavailable}</p>
        </section>
      )}
      {summary?.configured && !summary.linked && !summary.expected_username && (
        <section className="panel">
          <p>{s.identityRequired}</p>
        </section>
      )}
      {summary?.configured &&
        !summary.linked &&
        !!summary.expected_username && (
          <form
            className="panel sacco-connect"
            onSubmit={(e) => void connect(e)}
          >
            <h2>{s.connect}</h2>
            <p>{s.linkHelp}</p>
            <label>
              {s.username}
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                maxLength={100}
                readOnly
                autoComplete="username"
                disabled={busy}
              />
            </label>
            <label>
              {s.password}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={200}
                autoComplete="current-password"
                disabled={busy}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {s.connect}
            </button>
          </form>
        )}
      {summary?.linked && catalog && (
        <div className="sacco-layout">
          <aside className="sacco-nav">
            <p>{s.connected}</p>
            {catalog.resources.map((r) => (
              <button
                key={r.id}
                className={resource === r.id ? 'active' : ''}
                disabled={busy || !!pending}
                onClick={() => {
                  setResource(r.id);
                  setOffset(0);
                  setSearch('');
                  setError('');
                }}
              >
                {r.label}
              </button>
            ))}
            <button
              disabled={busy || !!pending}
              onClick={() =>
                void perform(async () => {
                  await api.saccoDisconnect(org, newTransactionId());
                  setSummary(await api.saccoSummary(org));
                  setCatalog(null);
                })
              }
            >
              {s.disconnect}
            </button>
          </aside>
          <main className="sacco-main">
            <section className="panel">
              <div className="sacco-section-head">
                <div>
                  <span className="eyebrow">{chosen?.currency}</span>
                  <h2>{definition?.label}</h2>
                </div>
                <button
                  className="button"
                  disabled={busy || !!pending}
                  onClick={() => void perform(refresh)}
                >
                  {busy ? s.loading : s.refresh}
                </button>
              </div>
              {resource === 'members' && (
                <label className="sacco-search">
                  {s.search}
                  <input
                    value={search}
                    disabled={!!pending}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                    }}
                    maxLength={100}
                  />
                </label>
              )}
              {resource === 'journals' && (
                <div className="sacco-field-grid">
                  <label>
                    {s.from}
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    {s.to}
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <label>
                    {saccoFieldLabels['officeId']}
                    <input
                      value={office}
                      inputMode="numeric"
                      onChange={(e) => setOffice(e.target.value)}
                    />
                  </label>
                </div>
              )}
              {resource === 'dividends' && (
                <>
                  <p>{s.dividendHelp}</p>
                  <label>
                    {saccoFieldLabels['productId']}
                    <input
                      value={dividendProduct}
                      inputMode="numeric"
                      maxLength={19}
                      disabled={!!pending}
                      onChange={(e) => {
                        setDividendProduct(e.target.value);
                        setOffset(0);
                      }}
                    />
                  </label>
                </>
              )}
              <DataTable
                rows={rows}
                {...(definition?.detail
                  ? { onOpen: (id: string) => void open(id) }
                  : {})}
              />
              <div className="sacco-paging">
                {total && (
                  <span>
                    {s.total}: {total}
                  </span>
                )}
                {definition?.page && (
                  <>
                    <button
                      className="button"
                      disabled={busy || !!pending || offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 50))}
                    >
                      {s.previous}
                    </button>
                    <button
                      className="button"
                      disabled={
                        busy ||
                        !!pending ||
                        rows.length < 50 ||
                        (!!total && BigInt(offset + 50) >= BigInt(total))
                      }
                      onClick={() => setOffset(offset + 50)}
                    >
                      {s.next}
                    </button>
                  </>
                )}
                <button
                  className="button"
                  disabled={!rows.length}
                  onClick={() => {
                    const keys = [
                      ...new Set(
                        rows.flatMap((r) =>
                          Object.keys(r).filter(
                            (k) =>
                              typeof r[k] === 'string' ||
                              typeof r[k] === 'boolean',
                          ),
                        ),
                      ),
                    ];
                    downloadCsv(`${resource}.csv`, [
                      keys,
                      ...rows.map((row) => keys.map((key) => text(row[key]))),
                    ]);
                  }}
                >
                  {s.export}
                </button>
              </div>
            </section>
            {detail && (
              <section className="panel">
                <h2>
                  {s.details} · {selected}
                </h2>
                <Detail
                  data={detail}
                  {...(resource === 'dividends'
                    ? {
                        offset: detailOffset,
                        busy,
                        onPage: (offset: number) =>
                          void perform(() => loadDetail(selected, offset)),
                      }
                    : {})}
                />
              </section>
            )}
            {operations.length > 0 && (
              <section className="panel">
                <h2>{s.actions}</h2>
                <p>{s.approvalHelp}</p>
                {['savings', 'loans'].includes(resource) && <p>{s.cashHelp}</p>}
                <label>
                  {s.chooseAction}
                  <select
                    value={action}
                    disabled={formDisabled}
                    onChange={(e) => {
                      setAction(e.target.value);
                      setValues({});
                      setPreview(null);
                    }}
                  >
                    <option value="">{s.select}</option>
                    {operations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {operation && (
                  <form onSubmit={(e) => void submit(e)}>
                    {operation.target && (
                      <label>
                        {s.id}
                        <input
                          value={selected}
                          required
                          disabled={formDisabled}
                          inputMode="numeric"
                          onChange={(e) => setSelected(e.target.value)}
                        />
                      </label>
                    )}
                    {operation.sub_target && (
                      <label>
                        {s.reference}
                        <input
                          value={subRecord}
                          required
                          disabled={formDisabled}
                          inputMode="numeric"
                          onChange={(e) => setSubRecord(e.target.value)}
                        />
                      </label>
                    )}
                    <div className="sacco-field-grid">
                      {operation.fields.map((field) => (
                        <Field
                          key={field.key}
                          field={field}
                          value={values[field.key] ?? ''}
                          onChange={(value) =>
                            setValues((v) => ({ ...v, [field.key]: value }))
                          }
                          template={template}
                          disabled={formDisabled}
                        />
                      ))}
                    </div>
                    <p className="hint">{s.exactHelp}</p>
                    <button className="button primary" disabled={formDisabled}>
                      {busy
                        ? s.working
                        : operation.quote
                          ? operation.label
                          : s.apply}
                    </button>
                  </form>
                )}
                {pending && (
                  <div className="sacco-pending">
                    <p>
                      {s.reference}: <code>{pending.request_id}</code>
                    </p>
                    <p>{s.uncertain}</p>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void perform(() => send(pending))}
                    >
                      {s.retry}
                    </button>
                  </div>
                )}
                {preview && <Detail data={preview} />}
              </section>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

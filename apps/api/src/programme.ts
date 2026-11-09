import { ApiError, object, textField } from './backend.js';
const unsigned = (r: Record<string, unknown>, key: string, signed = false) => {
  const value = textField(r, key);
  if (!(signed ? /^-?\d{1,40}$/ : /^\d{1,40}$/).test(value))
    throw new Error('Invalid aggregate');
  return value;
};
function array(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Missing aggregate rows');
  return value.map(object);
}
function day(value: string) {
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error('Invalid report date');
  return value;
}
export function checkedProgramme(raw: unknown, id: string, asOf?: string) {
  try {
    const r = object(raw),
      as_of = day(textField(r, 'as_of'));
    if (r['id'] !== id || (asOf && as_of !== asOf))
      throw new Error('Wrong programme scope');
    const seen = new Set<string>();
    const groups = array(r['groups']).map((g) => {
      const gid = textField(g, 'id'),
        status = textField(g, 'status'),
        currency = textField(g, 'currency'),
        digits = g['minor_digits'];
      if (
        seen.has(gid) ||
        !['active', 'inactive'].includes(status) ||
        !/^[A-Z]{3}$/.test(currency) ||
        typeof digits !== 'number' ||
        !Number.isInteger(digits) ||
        digits < 0 ||
        digits > 4
      )
        throw new Error('Invalid programme group');
      seen.add(gid);
      const last =
        g['last_meeting'] === null ? null : day(textField(g, 'last_meeting'));
      const days =
        last === null
          ? null
          : String((Date.parse(as_of) - Date.parse(last)) / 86400000);
      if (last && last > as_of) throw new Error('Future meeting');
      const arrears = unsigned(g, 'arrears'),
        ageingRaw = object(g['ageing']);
      const ageing = {
        days_1_30: unsigned(ageingRaw, 'days_1_30'),
        days_31_60: unsigned(ageingRaw, 'days_31_60'),
        days_61_90: unsigned(ageingRaw, 'days_61_90'),
        days_over_90: unsigned(ageingRaw, 'days_over_90'),
      };
      if (
        Object.values(ageing).reduce((s, v) => s + BigInt(v), 0n) !==
        BigInt(arrears)
      )
        throw new Error('Inconsistent ageing');
      if (
        g['days_since_meeting'] !== days ||
        g['meeting_attention'] !==
          (status === 'active' && (days === null || BigInt(days) >= 21n)) ||
        g['repayment_attention'] !==
          (status === 'active' && BigInt(arrears) > 0n)
      )
        throw new Error('Inconsistent health flags');
      let previous = '';
      const trends = array(g['trends']).map((t) => {
        const month = day(textField(t, 'month'));
        if (!month.endsWith('-01') || month <= previous || month > as_of)
          throw new Error('Invalid trend window');
        previous = month;
        const row = {
          month,
          meetings: unsigned(t, 'meetings'),
          roster: unsigned(t, 'roster'),
          present: unsigned(t, 'present'),
          absent: unsigned(t, 'absent'),
          excused: unsigned(t, 'excused'),
          scheduled_due: unsigned(t, 'scheduled_due'),
          repayments: unsigned(t, 'repayments', true),
          shares: unsigned(t, 'shares', true),
        };
        if (
          BigInt(row.present) + BigInt(row.absent) + BigInt(row.excused) >
          BigInt(row.roster)
        )
          throw new Error('Invalid attendance counts');
        return row;
      });
      if (trends.length !== 12) throw new Error('Incomplete annual trends');
      return {
        id: gid,
        name: textField(g, 'name'),
        status: status as 'active' | 'inactive',
        currency,
        minor_digits: digits,
        time_zone: textField(g, 'time_zone'),
        members: unsigned(g, 'members'),
        last_meeting: last,
        days_since_meeting: days,
        meeting_attention: g['meeting_attention'] as boolean,
        repayment_attention: g['repayment_attention'] as boolean,
        share_contributions: unsigned(g, 'share_contributions', true),
        outstanding_principal: unsigned(g, 'outstanding_principal'),
        arrears,
        loans_in_arrears: unsigned(g, 'loans_in_arrears'),
        ageing,
        trends,
      };
    });
    if (groups.length > 500) throw new Error('Programme capacity exceeded');
    const currencies = new Map<
      string,
      {
        currency: string;
        minor_digits: number;
        groups: string;
        share_contributions: string;
        outstanding_principal: string;
        arrears: string;
      }
    >();
    for (const g of groups) {
      const total = currencies.get(g.currency) ?? {
        currency: g.currency,
        minor_digits: g.minor_digits,
        groups: '0',
        share_contributions: '0',
        outstanding_principal: '0',
        arrears: '0',
      };
      if (total.minor_digits !== g.minor_digits)
        throw new Error('Inconsistent currency scale');
      total.groups = String(BigInt(total.groups) + 1n);
      for (const key of [
        'share_contributions',
        'outstanding_principal',
        'arrears',
      ] as const)
        total[key] = String(BigInt(total[key]) + BigInt(g[key]));
      currencies.set(g.currency, total);
    }
    return {
      id,
      name: textField(r, 'name'),
      as_of,
      time_zone: textField(r, 'time_zone'),
      groups,
      currencies: [...currencies.values()].sort((a, b) =>
        a.currency.localeCompare(b.currency),
      ),
    };
  } catch {
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  }
}

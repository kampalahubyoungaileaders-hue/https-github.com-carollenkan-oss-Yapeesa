import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { t } from '@yapesa/i18n';
import { ApiError, object, textField } from './backend.js';

export interface Statement {
  group: string;
  currency: string;
  minorDigits: number;
  timeZone: string;
  member: string | null;
  rows: {
    name: string;
    date: string;
    recordedAt: string;
    shares: string;
    amount: string;
    journal: string;
    note: string;
    review: boolean;
  }[];
}

// Parse only the result of the same user-token/RLS query as the saved workspace.
// A client-supplied member ID can narrow this result, never expand its scope.
export function statementData(raw: unknown, memberId?: string): Statement {
  const data = object(raw);
  const group = object(data['group']);
  const digits = group['minor_digits'];
  if (
    typeof digits !== 'number' ||
    !Number.isInteger(digits) ||
    digits < 0 ||
    digits > 4 ||
    !Array.isArray(data['members']) ||
    !Array.isArray(data['transactions'])
  )
    throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
  const members = new Map(
    data['members'].map((raw: unknown) => {
      const person = object(raw);
      return [textField(person, 'id'), textField(person, 'name')];
    }),
  );
  if (memberId && !members.has(memberId))
    throw new ApiError(404, 'MEMBER_NOT_FOUND');
  const currency = textField(group, 'currency');
  const rows = data['transactions']
    .flatMap((raw: unknown) => {
      const row = object(raw);
      const person = textField(row, 'member_id');
      if (memberId && person !== memberId) return [];
      const amount = textField(row, 'amount');
      const shares = textField(row, 'shares');
      const name = members.get(person);
      if (
        !name ||
        !/^[0-9]{1,19}$/.test(amount) ||
        !/^[0-9]{1,19}$/.test(shares) ||
        textField(row, 'currency') !== currency
      )
        throw new ApiError(502, 'INVALID_BACKEND_RESPONSE');
      return [
        {
          name,
          amount,
          shares,
          date: textField(row, 'meeting_date'),
          recordedAt: textField(row, 'recorded_at'),
          journal: textField(row, 'journal_id'),
          note: textField(row, 'note'),
          review: row['calculation_mismatch'] === true,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.recordedAt.localeCompare(b.recordedAt) ||
        a.journal.localeCompare(b.journal),
    );
  // Bound report CPU/memory. Never silently truncate a financial statement.
  if (rows.length > 5000) throw new ApiError(422, 'STATEMENT_TOO_LARGE');
  return {
    group: textField(group, 'name'),
    currency,
    minorDigits: digits,
    timeZone: textField(group, 'time_zone'),
    member: memberId ? members.get(memberId)! : null,
    rows,
  };
}

export function statementAmount(amount: bigint, digits: number): string {
  const scale = 10n ** BigInt(digits);
  return `${amount / scale}${digits ? `.${String(amount % scale).padStart(digits, '0')}` : ''}`;
}

export async function renderStatement(
  statement: Statement,
  generated = new Date(),
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 44,
    bufferPages: true,
    info: {
      Title: t('pdfStatement'),
      Author: 'Yapesa',
      CreationDate: generated,
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);
  });
  // Embedded font preserves accented names and common local-language glyphs.
  doc.font(fileURLToPath(new URL('../assets/DejaVuSans.ttf', import.meta.url)));
  const width = doc.page.width - 88;
  let y = 0;
  const text = (value: string, size = 9, color = '#263c42') => {
    doc
      .fontSize(size)
      .fillColor(color)
      .text(value, 44, y, { width, lineGap: 2 });
    y = doc.y + 5;
  };
  const header = () => {
    y = 40;
    text('Yapesa', 21, '#087f73');
    text(t('pdfStatement'), 13);
    text(statement.group, 12);
    if (statement.member) text(`${t('member')}: ${statement.member}`);
    text(
      `${t('pdfGenerated')}: ${generated.toISOString()} | ${statement.currency} | ${statement.timeZone}`,
      8,
      '#536970',
    );
    y += 6;
  };
  header();
  const totalShares = statement.rows.reduce(
    (sum, row) => sum + BigInt(row.shares),
    0n,
  );
  const total = statement.rows.reduce(
    (sum, row) => sum + BigInt(row.amount),
    0n,
  );
  text(
    `${t('pdfRecords')}: ${statement.rows.length}   |   ${t('sharesLabel')}: ${totalShares}   |   ${t('pdfShareValue')}: ${statement.currency} ${statementAmount(total, statement.minorDigits)}`,
    10,
  );
  text(t('pdfScope'), 8, '#536970');
  y += 8;
  if (!statement.rows.length) text(t('pdfEmpty'));
  for (const row of statement.rows) {
    const lines = [
      `${row.date} | ${row.name}`,
      `${t('sharesLabel')}: ${row.shares}   |   ${t('pdfAmount')}: ${statement.currency} ${statementAmount(BigInt(row.amount), statement.minorDigits)}`,
      `${t('journalRef')}: ${row.journal}`,
      `${t('pdfRecorded')}: ${row.recordedAt}`,
      ...(row.note ? [`${t('pdfNote')}: ${row.note}`] : []),
      ...(row.review ? [t('pdfReview')] : []),
    ];
    doc.fontSize(9);
    const height =
      lines.reduce(
        (sum, line) =>
          sum + doc.heightOfString(line, { width, lineGap: 2 }) + 5,
        0,
      ) + 16;
    if (y + height > doc.page.height - 65) {
      doc.addPage();
      header();
    }
    doc
      .strokeColor('#dce7e6')
      .moveTo(44, y)
      .lineTo(44 + width, y)
      .stroke();
    y += 9;
    for (const line of lines) text(line);
    y += 7;
  }
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    // Footer fits within the bottom margin without triggering another page.
    doc
      .fontSize(8)
      .fillColor('#536970')
      .text(
        `${t('pdfPage')} ${page + 1} / ${range.count}`,
        44,
        doc.page.height - 58,
        { width, lineBreak: false },
      );
  }
  doc.end();
  return finished;
}

import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { t } from '@yapesa/i18n';
import { ApiError, object, textField } from './backend.js';
import { statementAmount } from './statement.js';
export interface AuditDocument {
  groupId: string;
  groupName: string;
  currency: string;
  minorDigits: number;
  timeZone: string;
  from: string;
  to: string;
  reference: string | null;
  exporter: string;
  exporterName: string;
  events: {
    id: string;
    record: string;
    actor: string;
    actorName: string;
    device: string;
    action: string;
    at: string;
    evidence: string;
  }[];
  sources: { id: string; kind: string; evidence: string }[];
  journals: {
    id: string;
    at: string;
    version: string;
    lines: {
      id: string;
      account: string;
      side: 'debit' | 'credit';
      amount: string;
    }[];
  }[];
}
const invalid = () => new ApiError(502, 'INVALID_BACKEND_RESPONSE');
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw invalid();
  return value.map(object);
}
export function auditData(
  raw: unknown,
  groupId: string,
  from: string,
  to: string,
  reference?: string,
): AuditDocument {
  const data = object(raw),
    digits = data['minor_digits'];
  if (
    data['group_id'] !== groupId ||
    data['from_date'] !== from ||
    data['to_date'] !== to ||
    data['record_reference'] !== (reference ?? null) ||
    typeof digits !== 'number' ||
    !Number.isInteger(digits) ||
    digits < 0 ||
    digits > 4
  )
    throw invalid();
  const currency = textField(data, 'currency');
  if (!/^[A-Z]{3}$/.test(currency)) throw invalid();
  const events = rows(data['events']).map((e) => ({
    id: textField(e, 'id'),
    record: textField(e, 'record_id'),
    actor: textField(e, 'actor_id'),
    actorName: textField(e, 'actor_name'),
    device: textField(e, 'device_id'),
    action: textField(e, 'action'),
    at: textField(e, 'occurred_at'),
    evidence: textField(e, 'evidence'),
  }));
  const sources = rows(data['sources']).map((s) => ({
    id: textField(s, 'id'),
    kind: textField(s, 'kind'),
    evidence: textField(s, 'evidence'),
  }));
  const journals = rows(data['journals']).map((j) => {
    if (j['currency'] !== currency) throw invalid();
    const lines = rows(j['lines']).map((l) => {
      const amount = textField(l, 'amount'),
        side = l['side'];
      if (
        !/^[1-9][0-9]{0,18}$/.test(amount) ||
        BigInt(amount) > 9223372036854775807n ||
        (side !== 'debit' && side !== 'credit')
      )
        throw invalid();
      return {
        id: textField(l, 'id'),
        account: textField(l, 'account'),
        side: side as 'debit' | 'credit',
        amount,
      };
    });
    if (
      lines.length < 2 ||
      lines.reduce(
        (sum, l) =>
          sum + (l.side === 'debit' ? BigInt(l.amount) : -BigInt(l.amount)),
        0n,
      ) !== 0n
    )
      throw invalid();
    return {
      id: textField(j, 'id'),
      at: textField(j, 'created_at'),
      version: textField(j, 'calc_version'),
      lines,
    };
  });
  if (
    textField(data, 'event_count') !== String(events.length) ||
    textField(data, 'source_count') !== String(sources.length) ||
    textField(data, 'line_count') !==
      String(journals.reduce((n, j) => n + j.lines.length, 0))
  )
    throw invalid();
  if (
    events.length > 5000 ||
    sources.length > 5000 ||
    journals.length > 5000 ||
    journals.reduce((n, j) => n + j.lines.length, 0) > 20000 ||
    [...events, ...sources].reduce(
      (n, e) => n + Buffer.byteLength(e.evidence),
      0,
    ) > 2000000
  )
    throw new ApiError(422, 'AUDIT_TOO_LARGE');
  return {
    groupId,
    groupName: textField(data, 'group_name'),
    currency,
    minorDigits: digits,
    timeZone: textField(data, 'time_zone'),
    from,
    to,
    reference: reference ?? null,
    exporter: textField(data, 'exported_by'),
    exporterName: textField(data, 'exported_by_name'),
    events,
    sources,
    journals,
  };
}
export async function renderAudit(
  data: AuditDocument,
  generated = new Date(),
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 44,
    bufferPages: true,
    info: {
      Title: t('auditPdfTitle'),
      Author: 'Yapesa',
      CreationDate: generated,
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);
  });
  doc.font(fileURLToPath(new URL('../assets/DejaVuSans.ttf', import.meta.url)));
  const width = doc.page.width - 88,
    bottom = doc.page.height - 70;
  let y = 40,
    pages = 1;
  function header() {
    y = 40;
    doc
      .fontSize(19)
      .fillColor('#087f73')
      .text('Yapesa', 44, y, { width, lineBreak: true });
    y = doc.y + 7;
    doc
      .fontSize(12)
      .fillColor('#20383e')
      .text(t('auditPdfTitle'), 44, y, { width, lineBreak: true });
    y = doc.y + 5;
    doc.fontSize(10).text(data.groupName, 44, y, { width, lineBreak: true });
    y = doc.y + 5;
    doc.fontSize(8).text(`${t('auditGroupRef')}: ${data.groupId}`, 44, y, {
      width,
      lineBreak: true,
    });
    y = doc.y + 5;
    doc
      .fontSize(8)
      .fillColor('#536970')
      .text(
        `${data.from} - ${data.to} | ${data.timeZone} | ${data.currency}`,
        44,
        y,
        { width, lineBreak: true },
      );
    y = doc.y + 12;
  }
  function page() {
    if (++pages > 500) throw new ApiError(422, 'AUDIT_TOO_LARGE');
    doc.addPage();
    header();
  }
  function text(value: string, size = 9, color = '#263c42') {
    doc.fontSize(size).fillColor(color);
    for (const paragraph of value.split('\n')) {
      const chars = [...paragraph];
      let offset = 0;
      do {
        let lo = 1,
          hi = Math.min(180, chars.length - offset),
          take = hi;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (
            doc.widthOfString(chars.slice(offset, offset + mid).join('')) <=
            width
          ) {
            take = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        if (y + size * 1.5 > bottom) {
          page();
          doc.fontSize(size).fillColor(color);
        }
        doc.text(chars.slice(offset, offset + take).join(''), 44, y, {
          width,
          lineBreak: false,
        });
        y += size * 1.5;
        offset += take;
      } while (offset < chars.length);
    }
    y += 4;
  }
  function section(value: string, minimumSpace = 44) {
    if (y + minimumSpace > bottom) page();
    y += 8;
    doc
      .strokeColor('#dce7e6')
      .moveTo(44, y)
      .lineTo(44 + width, y)
      .stroke();
    y += 10;
    text(value, 11, '#087f73');
  }
  try {
    header();
    text(`${t('pdfGenerated')}: ${generated.toISOString()}`, 8);
    text(`${t('auditExporter')}: ${data.exporterName} | ${data.exporter}`, 8);
    if (data.reference) text(`${t('auditReference')}: ${data.reference}`, 8);
    text(t('auditPdfScope'), 8);
    text(
      `${t('auditActions')}: ${data.events.length} | ${t('auditSources')}: ${data.sources.length} | ${t('auditJournals')}: ${data.journals.length}`,
      9,
    );
    if (!data.events.length) text(t('auditEmpty'));
    for (const e of data.events) {
      section(`${t('auditAction')}: ${e.action}`, 155);
      text(`${t('auditRecorded')}: ${e.at}`, 8);
      text(`${t('auditActor')}: ${e.actorName} | ${e.actor}`, 8);
      text(`${t('auditDevice')}: ${e.device}`, 8);
      text(`${t('auditEvent')}: ${e.id}`, 8);
      text(`${t('auditReference')}: ${e.record}`, 8);
      text(`${t('auditEvidence')}:`);
      text(e.evidence, 8);
    }
    if (data.sources.length) {
      section(t('auditSources'));
      text(t('auditLinkedScope'), 8);
      for (const s of data.sources) {
        section(`${s.kind} | ${s.id}`);
        text(s.evidence, 8);
      }
    }
    if (data.journals.length) {
      section(t('auditJournals'));
      text(t('auditLinkedScope'), 8);
      for (const j of data.journals) {
        section(`${t('journalRef')}: ${j.id}`);
        text(`${t('auditRecorded')}: ${j.at}`, 8);
        text(`${t('auditVersion')}: ${j.version}`, 8);
        for (const l of j.lines)
          text(
            `${l.side.toUpperCase()} | ${l.account} | ${data.currency} ${statementAmount(BigInt(l.amount), data.minorDigits)}`,
          );
      }
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor('#536970')
        .text(
          `${t('pdfPage')} ${i + 1} / ${range.count}`,
          44,
          doc.page.height - 56,
          { width, lineBreak: false },
        );
    }
    doc.end();
    return await finished;
  } catch (error) {
    doc.destroy();
    void finished.catch(() => {});
    throw error;
  }
}

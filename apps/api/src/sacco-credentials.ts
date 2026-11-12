import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './backend.js';
import type { FineractCredentials } from './fineract.js';
const keyFor = (master: Buffer) =>
  createHmac('sha256', master)
    .update('yapesa-fineract-credentials-v1')
    .digest();
const aadFor = (person: string, org: string, version: string, user: string) =>
  Buffer.from(JSON.stringify([person, org, version, user]));
export function sealFineract(
  actor: FineractCredentials,
  master: Buffer,
  person: string,
  org: string,
  version: string,
  user: string,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', keyFor(master), iv);
  cipher.setAAD(aadFor(person, org, version, user));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(actor), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
export function openFineract(
  raw: string,
  master: Buffer,
  person: string,
  org: string,
  version: string,
  user: string,
): FineractCredentials {
  try {
    if (raw.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(raw))
      throw new Error('Envelope');
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.length < 29) throw new Error('Envelope');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(master),
      bytes.subarray(0, 12),
    );
    cipher.setAAD(aadFor(person, org, version, user));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const value: unknown = JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString('utf8'),
    );
    if (
      !value ||
      typeof value !== 'object' ||
      !('username' in value) ||
      !('password' in value) ||
      typeof value.username !== 'string' ||
      typeof value.password !== 'string'
    )
      throw new Error('Credential');
    return { username: value.username, password: value.password };
  } catch {
    throw new ApiError(403, 'FINERACT_RELINK_REQUIRED');
  }
}

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
export interface Tokens {
  access_token: string;
  refresh_token: string;
}
export function deriveAuthPassword(
  phone: string,
  pin: string,
  pepper: string,
): string {
  if (
    !/^\+[1-9][0-9]{6,14}$/.test(phone) ||
    !/^\d{6}$/.test(pin) ||
    pepper.length < 32
  )
    throw new Error('Invalid credentials');
  return createHmac('sha256', pepper)
    .update(`yapesa-pin-v1\0${phone}\0${pin}`)
    .digest('base64url');
}
export function sealTokens(tokens: Tokens, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    'base64url',
  );
}
export function openTokens(cookie: string, key: Buffer): Tokens {
  if (cookie.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(cookie))
    throw new Error('Invalid cookie');
  const data = Buffer.from(cookie, 'base64url');
  if (data.length < 29) throw new Error('Invalid cookie');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  const value: unknown = JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString('utf8'),
  );
  if (
    !value ||
    typeof value !== 'object' ||
    !('access_token' in value) ||
    !('refresh_token' in value) ||
    typeof value.access_token !== 'string' ||
    typeof value.refresh_token !== 'string'
  )
    throw new Error('Invalid cookie');
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
  };
}

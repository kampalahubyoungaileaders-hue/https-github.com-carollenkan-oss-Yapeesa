import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';

// Compatibility with unmodified Fineract 1.12 EncryptionUtil and its published
// test vector. This format is for the native tenant registry only. Yapesa staff
// credential envelopes continue to use authenticated AES-GCM.
// https://github.com/apache/fineract/blob/1.12.0/fineract-core/src/main/java/org/apache/fineract/infrastructure/security/utils/EncryptionUtil.java
function check(value: string) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 4096)
    throw new Error('INVALID_NATIVE_PASSWORD_FORMAT');
}
export function encryptTenantPassword(
  master: string,
  password: string,
): string {
  check(master);
  check(password);
  const iv = randomBytes(16),
    salt = randomBytes(16);
  const key = pbkdf2Sync(master, salt, 65536, 32, 'sha1');
  try {
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([
      iv,
      salt,
      cipher.update(password, 'utf8'),
      cipher.final(),
    ]).toString('base64');
  } finally {
    key.fill(0);
  }
}
export function decryptTenantPassword(master: string, encoded: string): string {
  check(master);
  if (
    typeof encoded !== 'string' ||
    encoded.length > 8192 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw new Error('INVALID_NATIVE_PASSWORD_FORMAT');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 48 || bytes.length % 16 !== 0)
    throw new Error('INVALID_NATIVE_PASSWORD_FORMAT');
  const key = pbkdf2Sync(master, bytes.subarray(16, 32), 65536, 32, 'sha1');
  try {
    const decipher = createDecipheriv(
      'aes-256-cbc',
      key,
      bytes.subarray(0, 16),
    );
    return Buffer.concat([
      decipher.update(bytes.subarray(32)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('INVALID_NATIVE_PASSWORD_FORMAT');
  } finally {
    key.fill(0);
  }
}

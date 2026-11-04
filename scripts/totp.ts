// Test/provisioning utility. Secrets are generated locally, never committed.
import { createHmac } from 'node:crypto';
export function totp(secret: string, time = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase().replaceAll('=', '')) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw new Error('Invalid base32');
    bits += n.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const offset = (hash[hash.length - 1] ?? 0) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    '0',
  );
}

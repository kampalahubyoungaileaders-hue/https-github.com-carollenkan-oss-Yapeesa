import { Webhook } from 'standardwebhooks';

export interface SmsConfig {
  username: string | undefined;
  password: string | undefined;
  senderId: string | undefined;
  hookSecret: string | undefined;
}
const endpoint = 'https://comms.egosms.co/api/v1/json/';
const maxBytes = 16384;
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function failure(status: number, message: string) {
  return Response.json({ error: { http_code: status, message } }, { status });
}
async function boundedText(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// Only Auth-signed OTP payloads are accepted. This is not a general SMS endpoint.
// Provider errors, credentials, phone numbers and OTPs are never logged or echoed.
export function createSmsHandler(
  config: SmsConfig,
  send: typeof fetch = fetch,
) {
  let webhook: Webhook | null = null;
  const sender = config.senderId?.trim();
  try {
    if (
      config.hookSecret &&
      config.username &&
      config.password &&
      (!sender ||
        (sender.length <= 11 &&
          ![...sender].some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
          )))
    ) {
      webhook = new Webhook(config.hookSecret.replace(/^v1,/, ''));
    }
  } catch {
    /* misconfigured signing key: fail closed */
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return failure(405, 'Method not allowed');
    // Check headers before reading a body or inspecting delivery configuration.
    if (
      !request.headers.get('webhook-id') ||
      !request.headers.get('webhook-timestamp') ||
      !request.headers.get('webhook-signature')
    )
      return failure(401, 'Invalid hook signature');
    if (!webhook) return failure(503, 'SMS delivery unavailable');
    let payload: string | null;
    try {
      payload = await boundedText(request);
    } catch {
      return failure(400, 'Invalid hook payload');
    }
    if (payload === null) return failure(413, 'Hook payload too large');
    let verified: unknown;
    try {
      verified = webhook.verify(payload, Object.fromEntries(request.headers));
    } catch {
      return failure(401, 'Invalid hook signature');
    }
    const data = object(verified);
    const user = object(data?.['user']);
    const sms = object(data?.['sms']);
    const phone = user?.['phone'];
    const otp = sms?.['otp'];
    if (
      typeof phone !== 'string' ||
      !/^\+?[1-9][0-9]{6,14}$/.test(phone) ||
      typeof otp !== 'string' ||
      !/^[0-9]{6,10}$/.test(otp)
    )
      return failure(400, 'Invalid hook payload');
    try {
      const response = await send(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(3500),
        body: JSON.stringify({
          method: 'SendSms',
          userdata: { username: config.username, password: config.password },
          msgdata: [
            {
              number: phone.replace(/^\+/, ''),
              message: `Your Yapesa verification code is ${otp}. Do not share this code.`,
              ...(sender ? { senderid: sender } : {}),
              priority: 1,
            },
          ],
        }),
      });
      if (!response.ok) return failure(502, 'SMS delivery failed');
      const result = object((await response.json()) as unknown);
      if (result?.['Status'] !== 'OK')
        return failure(502, 'SMS delivery failed');
      return Response.json({});
    } catch {
      // No automatic retry: a transport failure may follow provider acceptance.
      return failure(502, 'SMS delivery failed');
    }
  };
}

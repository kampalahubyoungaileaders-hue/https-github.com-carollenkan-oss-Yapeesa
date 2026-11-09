import https from 'node:https';
import { Buffer } from 'node:buffer';
import { ApiError } from './backend.js';
export type FineractValue =
  null | boolean | string | FineractValue[] | { [key: string]: FineractValue };
/** Node 24 supplies the original numeric token to JSON.parse's reviver. */
export function fineractJson(raw: string): FineractValue {
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024)
    throw new ApiError(502, 'FINERACT_RESPONSE_LIMIT');
  try {
    const parse = JSON.parse as (
      text: string,
      reviver: (
        key: string,
        value: unknown,
        context?: { source?: string },
      ) => unknown,
    ) => unknown;
    return parse(raw, (_key, value, context) => {
      if (typeof value !== 'number') return value;
      if (
        !context?.source ||
        !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(context.source)
      )
        throw new Error('Exact number source required');
      return context.source;
    }) as FineractValue;
  } catch {
    throw new ApiError(502, 'INVALID_FINERACT_RESPONSE');
  }
}
export function fineractMinor(decimal: string, digits: number): string {
  if (
    !Number.isInteger(digits) ||
    digits < 0 ||
    digits > 6 ||
    decimal.length > 100
  )
    throw new ApiError(502, 'INVALID_FINERACT_AMOUNT');
  const m = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d{1,2}))?$/.exec(
    decimal,
  );
  if (!m) throw new ApiError(502, 'INVALID_FINERACT_AMOUNT');
  const exponent =
    BigInt(m[4] ?? '0') + BigInt(digits) - BigInt((m[3] ?? '').length);
  if (exponent < -40n || exponent > 40n)
    throw new ApiError(502, 'INVALID_FINERACT_AMOUNT');
  const coefficient = BigInt(`${m[1]}${m[2]}${m[3] ?? ''}`);
  const divisor = 10n ** (exponent < 0n ? -exponent : 0n);
  if (coefficient % divisor !== 0n)
    throw new ApiError(502, 'FINERACT_FRACTIONAL_MINOR_UNIT');
  return (
    exponent >= 0n ? coefficient * 10n ** exponent : coefficient / divisor
  ).toString();
}
export interface FineractCredentials {
  username: string;
  password: string;
}
export interface FineractEndpoint {
  url: string;
  localTest?: boolean;
}
export class Fineract {
  private readonly base: URL;
  constructor(
    endpoint: FineractEndpoint,
    readonly tenant: string,
    private readonly actor: FineractCredentials,
  ) {
    this.base = new URL(endpoint.url);
    const local = ['127.0.0.1', 'localhost'].includes(this.base.hostname);
    if (
      this.base.protocol !== 'https:' ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== '/fineract-provider/api/v1/' ||
      !/^[a-z][a-z0-9_-]{0,62}$/.test(tenant) ||
      !actor.username ||
      actor.username.includes(':') ||
      /[\r\n]/.test(actor.username) ||
      !actor.password ||
      (endpoint.localTest && (!local || this.base.port !== '8443')) ||
      (tenant === 'default' && !endpoint.localTest)
    )
      throw new ApiError(503, 'INVALID_FINERACT_CONFIGURATION');
    this.localTest = endpoint.localTest === true;
  }
  private readonly localTest: boolean;
  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    requestId?: string,
  ): Promise<FineractValue> {
    if (
      !/^[a-z][A-Za-z0-9/_?=&.%+-]*$/.test(path) ||
      path.includes('..') ||
      /%2f|%5c|%2e/i.test(path)
    )
      throw new ApiError(400, 'INVALID_FINERACT_OPERATION');
    const url = new URL(path, this.base);
    if (
      url.origin !== this.base.origin ||
      !url.pathname.startsWith(this.base.pathname)
    )
      throw new ApiError(400, 'INVALID_FINERACT_OPERATION');
    const mutating = method !== 'GET' && path !== 'authentication';
    const payload =
      body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    if (payload && payload.length > 64 * 1024)
      throw new ApiError(413, 'FINERACT_REQUEST_LIMIT');
    // No redirects, automatic retries, global TLS exceptions, or shared actor.
    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          rejectUnauthorized: !this.localTest,
          timeout: 20000,
          headers: {
            Accept: 'application/json',
            'Fineract-Platform-TenantId': this.tenant,
            Authorization: `Basic ${Buffer.from(`${this.actor.username}:${this.actor.password}`).toString('base64')}`,
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': String(payload.length),
                }
              : {}),
            ...(requestId ? { 'Idempotency-Key': requestId } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let length = 0;
          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 4 * 1024 * 1024)
              req.destroy(new Error('Response limit'));
            else chunks.push(chunk);
          });
          res.on('error', () =>
            reject(
              new ApiError(
                503,
                !mutating
                  ? 'FINERACT_UNAVAILABLE'
                  : 'FINERACT_OUTCOME_UNCERTAIN',
              ),
            ),
          );
          res.on('end', () => {
            if (
              !res.statusCode ||
              res.statusCode < 200 ||
              res.statusCode >= 300
            ) {
              const status = res.statusCode ?? 503;
              if (
                mutating &&
                ![400, 401, 403, 404, 405, 409, 422].includes(status)
              ) {
                reject(new ApiError(503, 'FINERACT_OUTCOME_UNCERTAIN'));
                return;
              }
              let fields: string[] = [];
              try {
                const result = fineractJson(
                  Buffer.concat(chunks).toString('utf8'),
                );
                if (
                  result &&
                  typeof result === 'object' &&
                  !Array.isArray(result) &&
                  Array.isArray(result['errors'])
                )
                  fields = result['errors']
                    .flatMap((value) =>
                      value &&
                      typeof value === 'object' &&
                      !Array.isArray(value) &&
                      typeof value['parameterName'] === 'string' &&
                      /^[A-Za-z0-9_]{1,80}$/.test(value['parameterName'])
                        ? [value['parameterName']]
                        : [],
                    )
                    .slice(0, 20);
              } catch {
                /* Never expose raw upstream error bodies. */
              }

              reject(
                new ApiError(
                  status === 401
                    ? 401
                    : status === 403
                      ? 403
                      : status >= 500
                        ? 503
                        : status === 409
                          ? 409
                          : 422,
                  status === 401
                    ? 'FINERACT_CREDENTIALS_REJECTED'
                    : status === 403
                      ? 'FINERACT_PERMISSION_DENIED'
                      : status === 409
                        ? 'FINERACT_CONFLICT'
                        : status >= 500
                          ? 'FINERACT_UNAVAILABLE'
                          : 'FINERACT_REQUEST_REJECTED',
                  fields,
                ),
              );
              return;
            }
            try {
              const raw = Buffer.concat(chunks).toString('utf8');
              resolve(raw ? fineractJson(raw) : null);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', () =>
        reject(
          new ApiError(
            503,
            !mutating ? 'FINERACT_UNAVAILABLE' : 'FINERACT_OUTCOME_UNCERTAIN',
          ),
        ),
      );
      req.end(payload);
    });
  }
}

export interface ApiConfig {
  supabaseUrl: string;
  publishableKey: string;
  pinPepper: string;
  gatewayKey: string;
  cookieKey: Buffer;
  webOrigin: string;
  secureCookies: boolean;
}
export function readConfig(): ApiConfig | undefined {
  const env = process.env;
  const values = [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'PIN_PEPPER',
    'AUTH_GATEWAY_KEY',
    'SESSION_COOKIE_KEY',
  ] as const;
  if (values.every((name) => !env[name])) return undefined;
  if (values.some((name) => !env[name]))
    throw new Error('Complete the server authentication configuration');
  const url = new URL(env['SUPABASE_URL']!);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    )
  )
    throw new Error('Supabase requires HTTPS');
  if (!/^[a-f0-9]{64}$/i.test(env['SESSION_COOKIE_KEY']!))
    throw new Error('SESSION_COOKIE_KEY must be 32 random bytes in hex');
  if (env['PIN_PEPPER']!.length < 32 || env['AUTH_GATEWAY_KEY']!.length < 32)
    throw new Error(
      'Authentication secrets must contain at least 32 characters',
    );
  const origin = new URL(env['WEB_ORIGIN'] ?? 'http://127.0.0.1:5173').origin;
  if (env['NODE_ENV'] === 'production' && !origin.startsWith('https://'))
    throw new Error('Production WEB_ORIGIN requires HTTPS');
  return {
    supabaseUrl: url.origin,
    publishableKey: env['SUPABASE_PUBLISHABLE_KEY']!,
    pinPepper: env['PIN_PEPPER']!,
    gatewayKey: env['AUTH_GATEWAY_KEY']!,
    cookieKey: Buffer.from(env['SESSION_COOKIE_KEY']!, 'hex'),
    webOrigin: origin,
    secureCookies: env['NODE_ENV'] === 'production',
  };
}
